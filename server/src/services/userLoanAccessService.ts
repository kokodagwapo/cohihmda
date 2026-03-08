/**
 * User Loan Access Service
 * Provides loan-level access scoping based on Encompass permissions
 * 
 * This service syncs loan access from Encompass using user impersonation,
 * ensuring Cohi mirrors the exact permissions each user has in Encompass.
 * 
 * USAGE PATTERNS:
 * 
 * 1. For route handlers (with request context):
 *    const ctx = await getLoanAccessContext(req);
 *    if (ctx.hasNoAccess) return res.json({ data: [] });
 *    const { accessClause, accessParams } = ctx.buildWhereClause('l');
 * 
 * 2. For services (with userId and pool):
 *    const filter = await getUserLoanAccessFilter(userId, pool, { loanTableAlias: 'l' });
 * 
 * 3. For metricsService integration:
 *    const options = { userAccessFilter: await getUserLoanAccessFilter(userId, pool) };
 */

import pg from "pg";
import { logDebug, logWarn, logInfo, logError } from "./logger.js";
import { EncompassApiService } from "./encompassApiService.js";

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export interface UserAccessInfo {
  userId: string;
  role: string;
  persona: "tenant_admin" | "tenant_user" | "tenant_canvas_only_user";
  encompassUserId?: string;
  losConnectionId?: string;
  loanScope: "all" | "encompass" | "manual" | "none";
  loanAccessMode: "encompass_sync" | "full_access" | "no_access" | "manual"; // legacy mirror
  loanAccessSyncedAt?: Date;
  isAdmin: boolean;
  isTenantAdmin: boolean;
}

export interface LoanAccessFilter {
  sql: string;
  params: any[];
  paramOffset: number;
}

export interface LoanAccessSyncResult {
  success: boolean;
  loansAccessible: number;
  loansAdded: number;
  loansRemoved: number;
  durationMs: number;
  error?: string;
}

/**
 * Loan access context for use in route handlers
 * Provides convenient methods for building queries with access filtering
 */
export interface LoanAccessContext {
  /** User's access info (null if user not found) */
  accessInfo: UserAccessInfo | null;
  /** True if user has full access to all loans */
  hasFullAccess: boolean;
  /** True if user has no access to any loans */
  hasNoAccess: boolean;
  /** True if user access requires filtering via junction table */
  requiresFiltering: boolean;
  /** User ID for parameter binding */
  userId: string | null;
  /**
   * Build WHERE clause fragment for loan access
   * @param tableAlias - Alias of loans table (default: 'l')
   * @param startParamIndex - Starting parameter index (default: 1)
   * @returns Object with clause string, params array, and next param index
   */
  buildWhereClause: (tableAlias?: string, startParamIndex?: number) => {
    accessClause: string;
    accessParams: any[];
    nextParamIndex: number;
  };
  /**
   * Get raw filter object for metricsService integration
   */
  getFilter: (tableAlias?: string, startParamIndex?: number) => LoanAccessFilter | null;
}

// Roles that have full loan access
const FULL_ACCESS_ROLES = ["tenant_admin", "super_admin", "platform_admin"];

// =============================================================================
// CONTEXT BUILDER (Primary API for Routes)
// =============================================================================

/**
 * Get loan access context from an Express request
 * This is the primary API for route handlers
 * 
 * @example
 * router.get('/stats', async (req, res) => {
 *   const ctx = await getLoanAccessContext(req);
 *   if (ctx.hasNoAccess) return res.json({ stats: emptyStats() });
 *   
 *   const { accessClause, accessParams, nextParamIndex } = ctx.buildWhereClause('l');
 *   const query = `SELECT ... FROM loans l WHERE 1=1 ${accessClause} AND ...`;
 * });
 */
export async function getLoanAccessContext(
  req: { userId?: string; userRole?: string; isSuperAdmin?: boolean },
  pool: pg.Pool,
): Promise<LoanAccessContext> {
  const userId = req.userId || null;
  
  if (!userId) {
    return createNoAccessContext(null);
  }
  
  // Super admins and platform staff always have full access
  // They don't exist in tenant databases, so we can't query their access info there
  const userRole = req.userRole || '';
  if (req.isSuperAdmin || FULL_ACCESS_ROLES.includes(userRole)) {
    logDebug("[UserLoanAccess] Platform user granted full access", { userId, userRole });
    return createAccessContext({
      userId,
      role: userRole || 'super_admin',
      persona: "tenant_admin",
      loanScope: "all",
      loanAccessMode: 'full_access',
      isAdmin: true,
      isTenantAdmin: false,
    });
  }
  
  const accessInfo = await getUserAccessInfo(userId, pool);
  
  if (!accessInfo) {
    // User not found in tenant DB - could be a platform user
    // Check if they should have access based on JWT role
    logWarn("[UserLoanAccess] User not found in tenant database", { userId, userRole });
    return createNoAccessContext(userId);
  }
  
  return createAccessContext(accessInfo);
}

/**
 * Create a loan access context from user access info
 */
function createAccessContext(accessInfo: UserAccessInfo): LoanAccessContext {
  const hasFullAccess = accessInfo.loanAccessMode === "full_access";
  const hasNoAccess = accessInfo.loanAccessMode === "no_access";
  const requiresFiltering = !hasFullAccess && !hasNoAccess;
  
  return {
    accessInfo,
    hasFullAccess,
    hasNoAccess,
    requiresFiltering,
    userId: accessInfo.userId,
    
    buildWhereClause(tableAlias = "l", startParamIndex = 1) {
      if (hasFullAccess) {
        return {
          accessClause: "",
          accessParams: [],
          nextParamIndex: startParamIndex,
        };
      }
      
      if (hasNoAccess) {
        return {
          accessClause: "AND FALSE",
          accessParams: [],
          nextParamIndex: startParamIndex,
        };
      }
      
      // Requires filtering via junction table
      // Handle empty table alias (no prefix needed)
      const guidColumn = tableAlias ? `${tableAlias}.guid` : 'guid';
      return {
        accessClause: `AND ${guidColumn} IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $${startParamIndex})`,
        accessParams: [accessInfo.userId],
        nextParamIndex: startParamIndex + 1,
      };
    },
    
    getFilter(tableAlias = "l", startParamIndex = 1) {
      return buildLoanAccessFilter(accessInfo, tableAlias, startParamIndex);
    },
  };
}

/**
 * Create a no-access context (for missing users or errors)
 */
function createNoAccessContext(userId: string | null): LoanAccessContext {
  return {
    accessInfo: null,
    hasFullAccess: false,
    hasNoAccess: true,
    requiresFiltering: false,
    userId,
    
    buildWhereClause(_tableAlias = "l", startParamIndex = 1) {
      return {
        accessClause: "AND FALSE",
        accessParams: [],
        nextParamIndex: startParamIndex,
      };
    },
    
    getFilter() {
      return {
        sql: "FALSE",
        params: [],
        paramOffset: 0,
      };
    },
  };
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get user's loan access information
 */
export async function getUserAccessInfo(
  userId: string,
  pool: pg.Pool,
): Promise<UserAccessInfo | null> {
  try {
    const result = await pool.query(
      `
      SELECT 
        id, role, encompass_user_id, los_connection_id,
        persona,
        loan_scope,
        loan_access_synced_at
      FROM users 
      WHERE id = $1 AND is_active = true
    `,
      [userId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    const isAdmin = FULL_ACCESS_ROLES.includes(user.role);
    const isTenantAdmin = user.role === "tenant_admin";

    const persona = user.persona as UserAccessInfo["persona"];
    const loanScope = user.loan_scope as UserAccessInfo["loanScope"];
    const loanAccessMode =
      loanScope === "all"
        ? "full_access"
        : loanScope === "manual"
          ? "manual"
          : loanScope === "none"
            ? "no_access"
            : "encompass_sync";

    return {
      userId: user.id,
      role: user.role,
      persona,
      encompassUserId: user.encompass_user_id,
      losConnectionId: user.los_connection_id,
      loanScope,
      loanAccessMode,
      loanAccessSyncedAt: user.loan_access_synced_at,
      isAdmin,
      isTenantAdmin,
    };
  } catch (error: any) {
    logWarn("[UserLoanAccess] Failed to get user access info", {
      userId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Build SQL filter clause for loan access
 * Returns null if user has full access (no filter needed)
 * Returns { sql: 'FALSE', params: [] } if user has no access
 */
export function buildLoanAccessFilter(
  accessInfo: UserAccessInfo,
  loanTableAlias: string = "l",
  startParamIndex: number = 1,
): LoanAccessFilter | null {
  // Full access - no filter needed
  if (accessInfo.loanAccessMode === "full_access") {
    logDebug("[UserLoanAccess] Full access - no filter applied", {
      userId: accessInfo.userId,
    });
    return null;
  }

  // No access - return FALSE filter
  if (accessInfo.loanAccessMode === "no_access") {
    logDebug("[UserLoanAccess] No access - blocking all loans", {
      userId: accessInfo.userId,
    });
    return {
      sql: "FALSE",
      params: [],
      paramOffset: 0,
    };
  }

  // For encompass_sync or manual modes, use the junction table
  logDebug("[UserLoanAccess] Using user_loan_access junction table", {
    userId: accessInfo.userId,
    mode: accessInfo.loanAccessMode,
  });

  // Join with user_loan_access table to filter to only accessible loans
  // Handle empty table alias (no prefix needed)
  const guidColumn = loanTableAlias ? `${loanTableAlias}.guid` : 'guid';
  return {
    sql: `${guidColumn} IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $${startParamIndex})`,
    params: [accessInfo.userId],
    paramOffset: 1,
  };
}

/**
 * Apply loan access filter to a query
 * Convenience function that combines getUserAccessInfo and buildLoanAccessFilter
 */
export async function getUserLoanAccessFilter(
  userId: string,
  pool: pg.Pool,
  options?: {
    loanTableAlias?: string;
    startParamIndex?: number;
  },
): Promise<LoanAccessFilter | null> {
  const { loanTableAlias = "l", startParamIndex = 1 } = options || {};

  const accessInfo = await getUserAccessInfo(userId, pool);

  if (!accessInfo) {
    // User not found or inactive - block all access
    return {
      sql: "FALSE",
      params: [],
      paramOffset: 0,
    };
  }

  return buildLoanAccessFilter(accessInfo, loanTableAlias, startParamIndex);
}

/**
 * Sync loan access for a user from Encompass
 * Uses impersonation to query Pipeline API with user's permissions
 */
export async function syncUserLoanAccess(
  userId: string,
  pool: pg.Pool,
  tenantId: string,
): Promise<LoanAccessSyncResult> {
  const startTime = Date.now();
  let syncLogId: string | undefined;

  try {
    // Get user info
    const userResult = await pool.query(
      `SELECT id, encompass_user_id, los_connection_id, role FROM users WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return {
        success: false,
        loansAccessible: 0,
        loansAdded: 0,
        loansRemoved: 0,
        durationMs: Date.now() - startTime,
        error: "User not found",
      };
    }

    const user = userResult.rows[0];

    // Check if user has encompass mapping
    if (!user.encompass_user_id || !user.los_connection_id) {
      return {
        success: false,
        loansAccessible: 0,
        loansAdded: 0,
        loansRemoved: 0,
        durationMs: Date.now() - startTime,
        error: "User not linked to Encompass",
      };
    }

    // Skip sync for admin roles
    if (FULL_ACCESS_ROLES.includes(user.role)) {
      logInfo("[UserLoanAccess] Skipping sync for admin role", {
        userId,
        role: user.role,
      });
      return {
        success: true,
        loansAccessible: -1, // -1 indicates full access
        loansAdded: 0,
        loansRemoved: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Create sync log entry
    const logResult = await pool.query(
      `
      INSERT INTO user_loan_access_sync_log 
        (user_id, los_connection_id, status, started_at)
      VALUES ($1, $2, 'started', NOW())
      RETURNING id
    `,
      [userId, user.los_connection_id],
    );
    syncLogId = logResult.rows[0]?.id;

    logInfo("[UserLoanAccess] Starting loan access sync", {
      userId,
      encompassUserId: user.encompass_user_id,
    });

    // Get accessible loans from Encompass using impersonation
    const apiService = new EncompassApiService(pool);
    const { loanGuids: rawLoanGuids } = await apiService.getUserAccessibleLoans(
      tenantId,
      user.los_connection_id,
      user.encompass_user_id,
    );

    // Normalize GUIDs to match format in loans table (no braces, lowercase)
    // This is critical for the access filter join to work correctly
    const loanGuids = rawLoanGuids.map(guid => 
      guid.replace(/[{}]/g, '').toLowerCase()
    );
    
    logInfo("[UserLoanAccess] Normalized GUIDs for sync", {
      userId,
      rawCount: rawLoanGuids.length,
      normalizedCount: loanGuids.length,
      sampleRaw: rawLoanGuids.slice(0, 2),
      sampleNormalized: loanGuids.slice(0, 2),
    });

    // Get current access
    const currentAccessResult = await pool.query(
      `SELECT loan_guid FROM user_loan_access WHERE user_id = $1`,
      [userId],
    );
    const currentGuids = new Set(
      currentAccessResult.rows.map((r) => r.loan_guid),
    );
    const newGuids = new Set(loanGuids);

    // Calculate changes
    const toAdd = loanGuids.filter((g) => !currentGuids.has(g));
    const toRemove = [...currentGuids].filter((g) => !newGuids.has(g));

    // Apply changes in a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Remove old access
      if (toRemove.length > 0) {
        await client.query(
          `DELETE FROM user_loan_access WHERE user_id = $1 AND loan_guid = ANY($2)`,
          [userId, toRemove],
        );
      }

      // Add new access (in batches)
      const batchSize = 1000;
      for (let i = 0; i < toAdd.length; i += batchSize) {
        const batch = toAdd.slice(i, i + batchSize);
        const values = batch
          .map(
            (_, idx) =>
              `($1, $${idx + 2}, $${toAdd.length + 2})`,
          )
          .join(", ");

        if (batch.length > 0) {
          await client.query(
            `INSERT INTO user_loan_access (user_id, loan_guid, los_connection_id) 
             VALUES ${batch.map((_, idx) => `($1, $${idx + 2}, $${batch.length + 2})`).join(", ")}
             ON CONFLICT (user_id, loan_guid) DO UPDATE SET synced_at = NOW()`,
            [userId, ...batch, user.los_connection_id],
          );
        }
      }

      // Update user's sync timestamp
      await client.query(
        `UPDATE users SET loan_access_synced_at = NOW() WHERE id = $1`,
        [userId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const durationMs = Date.now() - startTime;

    // Update sync log
    if (syncLogId) {
      await pool.query(
        `
        UPDATE user_loan_access_sync_log 
        SET status = 'completed',
            loans_accessible = $1,
            loans_added = $2,
            loans_removed = $3,
            duration_ms = $4,
            completed_at = NOW()
        WHERE id = $5
      `,
        [loanGuids.length, toAdd.length, toRemove.length, durationMs, syncLogId],
      );
    }

    logInfo("[UserLoanAccess] Sync completed", {
      userId,
      loansAccessible: loanGuids.length,
      loansAdded: toAdd.length,
      loansRemoved: toRemove.length,
      durationMs,
    });

    return {
      success: true,
      loansAccessible: loanGuids.length,
      loansAdded: toAdd.length,
      loansRemoved: toRemove.length,
      durationMs,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    // Update sync log with error
    if (syncLogId) {
      await pool
        .query(
          `
        UPDATE user_loan_access_sync_log 
        SET status = 'failed',
            error_message = $1,
            duration_ms = $2,
            completed_at = NOW()
        WHERE id = $3
      `,
          [error.message, durationMs, syncLogId],
        )
        .catch(() => {});
    }

    logError("[UserLoanAccess] Sync failed", error, { userId });

    return {
      success: false,
      loansAccessible: 0,
      loansAdded: 0,
      loansRemoved: 0,
      durationMs,
      error: error.message,
    };
  }
}

/**
 * Get the count of loans a user can access
 */
export async function getUserAccessibleLoansCount(
  userId: string,
  pool: pg.Pool,
): Promise<number> {
  const accessInfo = await getUserAccessInfo(userId, pool);

  if (!accessInfo) {
    return 0;
  }

  if (accessInfo.loanAccessMode === "full_access") {
    const result = await pool.query("SELECT COUNT(*) as count FROM loans");
    return parseInt(result.rows[0]?.count || "0", 10);
  }

  if (accessInfo.loanAccessMode === "no_access") {
    return 0;
  }

  // Count from junction table
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM user_loan_access WHERE user_id = $1`,
    [userId],
  );

  return parseInt(result.rows[0]?.count || "0", 10);
}

/**
 * Check if user can access a specific loan
 */
export async function canUserAccessLoan(
  userId: string,
  loanGuid: string,
  pool: pg.Pool,
): Promise<boolean> {
  const accessInfo = await getUserAccessInfo(userId, pool);

  if (!accessInfo) {
    return false;
  }

  // Full access - can access any loan
  if (accessInfo.loanAccessMode === "full_access") {
    return true;
  }

  // No access
  if (accessInfo.loanAccessMode === "no_access") {
    return false;
  }

  // Check junction table
  const result = await pool.query(
    `SELECT 1 FROM user_loan_access WHERE user_id = $1 AND loan_guid = $2 LIMIT 1`,
    [userId, loanGuid],
  );

  return result.rows.length > 0;
}

/**
 * Middleware helper to extract user access filter for use in routes
 */
export function createLoanAccessMiddleware(pool: pg.Pool) {
  return async function applyLoanAccess(req: any, res: any, next: any) {
    try {
      if (!req.userId) {
        return next();
      }

      const accessInfo = await getUserAccessInfo(req.userId, pool);
      req.userAccessInfo = accessInfo;
      req.loanAccessFilter = accessInfo
        ? buildLoanAccessFilter(accessInfo)
        : { sql: "FALSE", params: [], paramOffset: 0 };

      next();
    } catch (error: any) {
      logWarn("[UserLoanAccess] Middleware error", { error: error.message });
      req.loanAccessFilter = { sql: "FALSE", params: [], paramOffset: 0 };
      next();
    }
  };
}

/**
 * Get user's loan access sync history
 */
export async function getUserLoanAccessSyncHistory(
  userId: string,
  pool: pg.Pool,
  limit: number = 10,
): Promise<
  Array<{
    id: string;
    status: string;
    loansAccessible: number;
    loansAdded: number;
    loansRemoved: number;
    errorMessage?: string;
    durationMs: number;
    startedAt: Date;
    completedAt?: Date;
  }>
> {
  const result = await pool.query(
    `
    SELECT 
      id, status, loans_accessible, loans_added, loans_removed,
      error_message, duration_ms, started_at, completed_at
    FROM user_loan_access_sync_log
    WHERE user_id = $1
    ORDER BY started_at DESC
    LIMIT $2
  `,
    [userId, limit],
  );

  return result.rows.map((r) => ({
    id: r.id,
    status: r.status,
    loansAccessible: r.loans_accessible,
    loansAdded: r.loans_added,
    loansRemoved: r.loans_removed,
    errorMessage: r.error_message,
    durationMs: r.duration_ms,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

// =============================================================================
// UTILITY FUNCTIONS FOR SQL QUERY BUILDING
// =============================================================================

/**
 * Build a complete SQL query with loan access filtering
 * Utility for one-off queries that don't use metricsService
 * 
 * @example
 * const { query, params } = await buildAccessFilteredQuery(
 *   userId,
 *   pool,
 *   'SELECT COUNT(*) FROM loans l WHERE l.funding_date IS NOT NULL',
 *   [],
 *   'l'
 * );
 */
export async function buildAccessFilteredQuery(
  userId: string,
  pool: pg.Pool,
  baseQuery: string,
  baseParams: any[] = [],
  tableAlias: string = "l",
): Promise<{ query: string; params: any[]; hasAccess: boolean }> {
  const accessInfo = await getUserAccessInfo(userId, pool);
  
  if (!accessInfo) {
    return { query: baseQuery + " AND FALSE", params: baseParams, hasAccess: false };
  }
  
  if (accessInfo.loanAccessMode === "full_access") {
    return { query: baseQuery, params: baseParams, hasAccess: true };
  }
  
  if (accessInfo.loanAccessMode === "no_access") {
    return { query: baseQuery + " AND FALSE", params: baseParams, hasAccess: false };
  }
  
  // Add junction table filter
  const paramIndex = baseParams.length + 1;
  const accessClause = ` AND ${tableAlias}.guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $${paramIndex})`;
  
  return {
    query: baseQuery + accessClause,
    params: [...baseParams, userId],
    hasAccess: true,
  };
}

/**
 * Wrap a subquery with access filtering
 * Useful for CTEs and complex queries
 * 
 * @example
 * const wrappedCTE = wrapQueryWithAccessFilter(
 *   userId,
 *   accessInfo,
 *   'SELECT * FROM loans WHERE status = $1',
 *   ['active'],
 *   'loans'
 * );
 */
export function wrapQueryWithAccessFilter(
  userId: string,
  accessInfo: UserAccessInfo | null,
  subquery: string,
  params: any[],
  tableAlias: string = "l",
): { sql: string; params: any[] } {
  if (!accessInfo || accessInfo.loanAccessMode === "no_access") {
    return { sql: `SELECT * FROM (${subquery}) ${tableAlias} WHERE FALSE`, params };
  }
  
  if (accessInfo.loanAccessMode === "full_access") {
    return { sql: subquery, params };
  }
  
  const paramIndex = params.length + 1;
  return {
    sql: `SELECT * FROM (${subquery}) ${tableAlias} WHERE ${tableAlias}.guid IN (SELECT loan_guid FROM user_loan_access WHERE user_id = $${paramIndex})`,
    params: [...params, userId],
  };
}

/**
 * Get empty/zero results object for when user has no access
 * Utility to quickly return empty results in route handlers
 */
export function getEmptyLoanResults<T extends Record<string, any>>(
  template: T,
): T {
  const result = { ...template };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === "number") {
      (result as any)[key] = 0;
    } else if (Array.isArray(value)) {
      (result as any)[key] = [];
    } else if (typeof value === "object" && value !== null) {
      (result as any)[key] = getEmptyLoanResults(value);
    }
  }
  return result;
}

/**
 * Quick check if user has any loan access (for early returns)
 */
export async function userHasLoanAccess(
  userId: string,
  pool: pg.Pool,
): Promise<boolean> {
  const accessInfo = await getUserAccessInfo(userId, pool);
  if (!accessInfo) return false;
  return accessInfo.loanAccessMode !== "no_access";
}

/**
 * Quick check if user has full loan access (no filtering needed)
 */
export async function userHasFullLoanAccess(
  userId: string,
  pool: pg.Pool,
): Promise<boolean> {
  const accessInfo = await getUserAccessInfo(userId, pool);
  if (!accessInfo) return false;
  return accessInfo.loanAccessMode === "full_access";
}
