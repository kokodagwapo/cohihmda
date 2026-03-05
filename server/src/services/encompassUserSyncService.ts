/**
 * Encompass User Sync Service
 * Handles syncing Encompass users to local cache and inviting users to Cohi
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { EncompassApiService, EncompassUser } from "./encompassApiService.js";
import { logError, logInfo, logDebug, logWarn } from "./logger.js";
import { sendUserInvitationEmail } from "./emailService.js";

const { Pool } = pg;

export interface CachedEncompassUser {
  id: string;
  los_connection_id: string;
  encompass_user_id: string;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  user_indicators: string[];
  is_enabled: boolean;
  cohi_user_id?: string;
  last_synced_at: Date;
  created_at: Date;
}

export interface SyncResult {
  success: boolean;
  users_fetched: number;
  users_added: number;
  users_updated: number;
  users_disabled: number;
  duration_ms: number;
  error?: string;
}

export interface InviteUserOptions {
  role?: string;
  invite_method?: "email" | "sso_only" | "manual";
  password?: string;
  inviter_name?: string;
  access_mode?: "full" | "canvas_only";
  group_ids?: string[];
}

export interface InviteResult {
  success: boolean;
  cohi_user_id?: string;
  invite_sent?: boolean;
  error?: string;
}

export class EncompassUserSyncService {
  private tenantPool: pg.Pool;
  private tenantId: string;
  private encompassApi: EncompassApiService;

  constructor(tenantPool: pg.Pool, tenantId: string) {
    this.tenantPool = tenantPool;
    this.tenantId = tenantId;
    this.encompassApi = new EncompassApiService(tenantPool);
  }

  /**
   * Sync users from Encompass to local cache
   */
  async syncUsers(
    losConnectionId: string,
    triggeredByUserId?: string,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let syncLogId: string | undefined;

    try {
      // Create sync log entry
      const logResult = await this.tenantPool.query(
        `
        INSERT INTO encompass_user_sync_log 
          (los_connection_id, triggered_by, status, started_at)
        VALUES ($1, $2, 'started', NOW())
        RETURNING id
      `,
        [losConnectionId, triggeredByUserId || null],
      );
      syncLogId = logResult.rows[0]?.id;

      logInfo("[EncompassUserSync] Starting user sync", {
        tenantId: this.tenantId,
        losConnectionId,
      });

      // Fetch users from Encompass
      const response = await this.encompassApi.getEncompassUsers(
        this.tenantId,
        losConnectionId,
        { enabledOnly: false, limit: 10000 }, // Fetch all to track disabled users
      );

      const encompassUsers = response.data;
      let usersAdded = 0;
      let usersUpdated = 0;
      let usersDisabled = 0;

      // Track which users we've seen for disabling stale entries
      const seenUserIds = new Set<string>();

      // Upsert each user
      for (const user of encompassUsers) {
        seenUserIds.add(user.id);

        const result = await this.upsertEncompassUser(losConnectionId, user);
        if (result.inserted) {
          usersAdded++;
        } else if (result.updated) {
          usersUpdated++;
        }
      }

      // Disable users no longer in Encompass response
      const disableResult = await this.tenantPool.query(
        `
        UPDATE encompass_users 
        SET is_enabled = false, last_synced_at = NOW()
        WHERE los_connection_id = $1 
        AND encompass_user_id NOT IN (SELECT unnest($2::text[]))
        AND is_enabled = true
        RETURNING id
      `,
        [losConnectionId, Array.from(seenUserIds)],
      );

      usersDisabled = disableResult.rowCount || 0;

      const durationMs = Date.now() - startTime;

      // Update sync log
      if (syncLogId) {
        await this.tenantPool.query(
          `
          UPDATE encompass_user_sync_log 
          SET status = 'completed',
              users_fetched = $1,
              users_added = $2,
              users_updated = $3,
              users_disabled = $4,
              duration_ms = $5,
              completed_at = NOW()
          WHERE id = $6
        `,
          [
            encompassUsers.length,
            usersAdded,
            usersUpdated,
            usersDisabled,
            durationMs,
            syncLogId,
          ],
        );
      }

      logInfo("[EncompassUserSync] Sync completed", {
        tenantId: this.tenantId,
        fetched: encompassUsers.length,
        added: usersAdded,
        updated: usersUpdated,
        disabled: usersDisabled,
        durationMs,
      });

      return {
        success: true,
        users_fetched: encompassUsers.length,
        users_added: usersAdded,
        users_updated: usersUpdated,
        users_disabled: usersDisabled,
        duration_ms: durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Update sync log with error
      if (syncLogId) {
        await this.tenantPool
          .query(
            `
          UPDATE encompass_user_sync_log 
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

      logError("[EncompassUserSync] Sync failed", error, {
        tenantId: this.tenantId,
        losConnectionId,
      });

      return {
        success: false,
        users_fetched: 0,
        users_added: 0,
        users_updated: 0,
        users_disabled: 0,
        duration_ms: durationMs,
        error: error.message,
      };
    }
  }

  /**
   * Upsert a single Encompass user
   */
  private async upsertEncompassUser(
    losConnectionId: string,
    user: EncompassUser,
  ): Promise<{ inserted: boolean; updated: boolean }> {
    const result = await this.tenantPool.query(
      `
      INSERT INTO encompass_users 
        (los_connection_id, encompass_user_id, username, email, first_name, last_name, 
         user_indicators, is_enabled, job_title, personas, org_id, org_name, 
         nmls_id, phone, cell_phone, encompass_last_login, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      ON CONFLICT (los_connection_id, encompass_user_id) 
      DO UPDATE SET 
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        user_indicators = EXCLUDED.user_indicators,
        is_enabled = EXCLUDED.is_enabled,
        job_title = EXCLUDED.job_title,
        personas = EXCLUDED.personas,
        org_id = EXCLUDED.org_id,
        org_name = EXCLUDED.org_name,
        nmls_id = EXCLUDED.nmls_id,
        phone = EXCLUDED.phone,
        cell_phone = EXCLUDED.cell_phone,
        encompass_last_login = EXCLUDED.encompass_last_login,
        last_synced_at = NOW()
      RETURNING (xmax = 0) as inserted
    `,
      [
        losConnectionId,
        user.id,
        user.username,
        user.email,
        user.firstName,
        user.lastName,
        user.userIndicators || [],
        user.isEnabled,
        user.jobTitle || null,
        user.personas || [],
        user.orgId || null,
        user.orgName || null,
        user.nmlsId || null,
        user.phone || null,
        user.cellPhone || null,
        user.lastLogin ? new Date(user.lastLogin) : null,
      ],
    );

    const inserted = result.rows[0]?.inserted === true;
    return { inserted, updated: !inserted };
  }

  /**
   * Get cached Encompass users
   */
  async getCachedUsers(
    losConnectionId: string,
    options?: {
      search?: string;
      enabledOnly?: boolean;
      unlinkedOnly?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<{ users: CachedEncompassUser[]; total: number }> {
    const {
      search,
      enabledOnly = true,
      unlinkedOnly = false,
      page = 1,
      limit = 50,
    } = options || {};

    const offset = (page - 1) * limit;
    const conditions: string[] = ["los_connection_id = $1"];
    const params: any[] = [losConnectionId];
    let paramIndex = 2;

    if (enabledOnly) {
      conditions.push(`is_enabled = true`);
    }

    if (unlinkedOnly) {
      conditions.push(`cohi_user_id IS NULL`);
    }

    if (search) {
      conditions.push(`(
        full_name ILIKE $${paramIndex} OR 
        email ILIKE $${paramIndex} OR 
        username ILIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    // Get total count
    const countResult = await this.tenantPool.query(
      `SELECT COUNT(*) as total FROM encompass_users WHERE ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total || "0", 10);

    // Get paginated results
    const result = await this.tenantPool.query(
      `
      SELECT 
        id, los_connection_id, encompass_user_id, username, email,
        first_name, last_name, full_name, user_indicators, is_enabled,
        cohi_user_id, last_synced_at, created_at
      FROM encompass_users 
      WHERE ${whereClause}
      ORDER BY full_name ASC, username ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
      [...params, limit, offset],
    );

    return {
      users: result.rows,
      total,
    };
  }

  /**
   * Add a user to the given groups (idempotent)
   */
  private async addUserToGroups(
    userId: string,
    groupIds: string[],
  ): Promise<void> {
    if (groupIds.length === 0) return;
    for (const groupId of groupIds) {
      await this.tenantPool.query(
        `
        INSERT INTO user_group_memberships (group_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT (group_id, user_id) DO NOTHING
        `,
        [groupId, userId],
      );
    }
  }

  /**
   * Invite an Encompass user to Cohi
   */
  async inviteUser(
    encompassUserIdOrCacheId: string,
    losConnectionId: string,
    options?: InviteUserOptions,
  ): Promise<InviteResult> {
    const {
      role = "user",
      invite_method = "email",
      password,
      inviter_name,
      access_mode = "full",
      group_ids = [],
    } = options || {};

    try {
      // Find the cached Encompass user
      // Check if input looks like a UUID (for cache table id) or text (for encompass_user_id)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        encompassUserIdOrCacheId,
      );

      const userResult = await this.tenantPool.query(
        isUuid
          ? `SELECT * FROM encompass_users WHERE id = $1 AND los_connection_id = $2`
          : `SELECT * FROM encompass_users WHERE encompass_user_id = $1 AND los_connection_id = $2`,
        [encompassUserIdOrCacheId, losConnectionId],
      );

      if (userResult.rows.length === 0) {
        return { success: false, error: "Encompass user not found" };
      }

      const encompassUser = userResult.rows[0];

      // Check if already linked to a Cohi user
      if (encompassUser.cohi_user_id) {
        return {
          success: false,
          error: "User already linked to a Cohi account",
          cohi_user_id: encompassUser.cohi_user_id,
        };
      }

      // Check if email is available
      if (!encompassUser.email) {
        return {
          success: false,
          error: "Encompass user does not have an email address",
        };
      }

      // Check if a Cohi user with this email already exists
      const existingUser = await this.tenantPool.query(
        `SELECT id FROM users WHERE email = $1`,
        [encompassUser.email],
      );

      if (existingUser.rows.length > 0) {
        // Link existing user to Encompass
        await this.linkUserToEncompass(
          existingUser.rows[0].id,
          encompassUser.encompass_user_id,
          losConnectionId,
        );

        // Add to requested groups
        await this.addUserToGroups(existingUser.rows[0].id, group_ids);

        return {
          success: true,
          cohi_user_id: existingUser.rows[0].id,
          invite_sent: false,
        };
      }

      // Create new Cohi user
      let hashedPassword: string;
      let inviteToken: string | undefined;

      if (invite_method === "manual" && password) {
        hashedPassword = await bcrypt.hash(password, 12);
      } else if (invite_method === "sso_only") {
        // Random password for SSO-only users (not usable)
        hashedPassword = crypto.randomBytes(32).toString("hex");
      } else {
        // Generate invite token and temporary password
        inviteToken = crypto.randomBytes(32).toString("hex");
        hashedPassword = crypto.randomBytes(32).toString("hex"); // Temp, user must set
      }

      const newUserResult = await this.tenantPool.query(
        `
        INSERT INTO users 
          (email, encrypted_password, full_name, role, is_active, 
           encompass_user_id, los_connection_id, access_mode, loan_access_mode)
        VALUES ($1, $2, $3, $4, true, $5, $6, $7, 'full_access')
        RETURNING id
      `,
        [
          encompassUser.email,
          hashedPassword,
          encompassUser.full_name ||
            `${encompassUser.first_name || ""} ${encompassUser.last_name || ""}`.trim(),
          role,
          encompassUser.encompass_user_id,
          losConnectionId,
          access_mode,
        ],
      );

      const newUserId = newUserResult.rows[0].id;

      // Add to requested groups
      await this.addUserToGroups(newUserId, group_ids);

      // Link the encompass_users record
      await this.tenantPool.query(
        `
        UPDATE encompass_users 
        SET cohi_user_id = $1 
        WHERE id = $2
      `,
        [newUserId, encompassUser.id],
      );

      // Send invitation email if email invite method
      let inviteSent = false;
      if (invite_method === "email" && inviteToken) {
        try {
          const { resolveFrontendUrl } = await import("../utils/frontendUrl.js");
          const frontendUrl = resolveFrontendUrl();
          const inviteUrl = `${frontendUrl}/accept-invite?token=${inviteToken}&email=${encodeURIComponent(encompassUser.email)}`;

          // Get tenant name
          const tenantName = process.env.TENANT_NAME || "your organization";

          await sendUserInvitationEmail(
            encompassUser.email,
            inviteUrl,
            tenantName,
            inviter_name,
          );
          inviteSent = true;

          logInfo("[EncompassUserSync] Invitation email sent", {
            email: encompassUser.email,
            userId: newUserId,
          });
        } catch (emailError: any) {
          logWarn("[EncompassUserSync] Failed to send invitation email", {
            error: emailError.message,
            email: encompassUser.email,
          });
        }
      }

      logInfo("[EncompassUserSync] User invited successfully", {
        encompassUserId: encompassUser.encompass_user_id,
        cohiUserId: newUserId,
        email: encompassUser.email,
        role,
        inviteMethod: invite_method,
      });

      return {
        success: true,
        cohi_user_id: newUserId,
        invite_sent: inviteSent,
      };
    } catch (error: any) {
      logError("[EncompassUserSync] Failed to invite user", error, {
        encompassUserIdOrCacheId,
        losConnectionId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Bulk invite multiple Encompass users
   */
  async bulkInviteUsers(
    encompassUserIds: string[],
    losConnectionId: string,
    options?: InviteUserOptions,
  ): Promise<{
    success_count: number;
    failed_count: number;
    results: Array<{ encompass_user_id: string; result: InviteResult }>;
  }> {
    const results: Array<{ encompass_user_id: string; result: InviteResult }> =
      [];
    let successCount = 0;
    let failedCount = 0;

    for (const userId of encompassUserIds) {
      const result = await this.inviteUser(userId, losConnectionId, options);
      results.push({ encompass_user_id: userId, result });

      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    return {
      success_count: successCount,
      failed_count: failedCount,
      results,
    };
  }

  /**
   * Link an existing Cohi user to an Encompass user
   */
  async linkUserToEncompass(
    cohiUserId: string,
    encompassUserId: string,
    losConnectionId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Update the Cohi user
      const updateResult = await this.tenantPool.query(
        `
        UPDATE users 
        SET encompass_user_id = $1, los_connection_id = $2
        WHERE id = $3
        RETURNING id
      `,
        [encompassUserId, losConnectionId, cohiUserId],
      );

      if (updateResult.rowCount === 0) {
        return { success: false, error: "Cohi user not found" };
      }

      // Update the encompass_users cache
      await this.tenantPool.query(
        `
        UPDATE encompass_users 
        SET cohi_user_id = $1
        WHERE encompass_user_id = $2 AND los_connection_id = $3
      `,
        [cohiUserId, encompassUserId, losConnectionId],
      );

      logInfo("[EncompassUserSync] User linked to Encompass", {
        cohiUserId,
        encompassUserId,
        losConnectionId,
      });

      return { success: true };
    } catch (error: any) {
      logError("[EncompassUserSync] Failed to link user", error, {
        cohiUserId,
        encompassUserId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Unlink a Cohi user from Encompass
   */
  async unlinkUserFromEncompass(
    cohiUserId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current encompass_user_id before unlinking
      const userResult = await this.tenantPool.query(
        `SELECT encompass_user_id, los_connection_id FROM users WHERE id = $1`,
        [cohiUserId],
      );

      if (userResult.rows.length === 0) {
        return { success: false, error: "User not found" };
      }

      const { encompass_user_id, los_connection_id } = userResult.rows[0];

      // Remove link from Cohi user
      await this.tenantPool.query(
        `
        UPDATE users 
        SET encompass_user_id = NULL, los_connection_id = NULL
        WHERE id = $1
      `,
        [cohiUserId],
      );

      // Remove link from encompass_users cache
      if (encompass_user_id && los_connection_id) {
        await this.tenantPool.query(
          `
          UPDATE encompass_users 
          SET cohi_user_id = NULL
          WHERE encompass_user_id = $1 AND los_connection_id = $2
        `,
          [encompass_user_id, los_connection_id],
        );
      }

      logInfo("[EncompassUserSync] User unlinked from Encompass", {
        cohiUserId,
      });

      return { success: true };
    } catch (error: any) {
      logError("[EncompassUserSync] Failed to unlink user", error, {
        cohiUserId,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get sync history
   */
  async getSyncHistory(
    losConnectionId: string,
    limit: number = 10,
  ): Promise<
    Array<{
      id: string;
      status: string;
      users_fetched: number;
      users_added: number;
      users_updated: number;
      users_disabled: number;
      error_message?: string;
      duration_ms: number;
      started_at: Date;
      completed_at?: Date;
    }>
  > {
    const result = await this.tenantPool.query(
      `
      SELECT 
        id, status, users_fetched, users_added, users_updated, 
        users_disabled, error_message, duration_ms, started_at, completed_at
      FROM encompass_user_sync_log
      WHERE los_connection_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `,
      [losConnectionId, limit],
    );

    return result.rows;
  }
}

// Factory function for creating service instances
export function createEncompassUserSyncService(
  tenantPool: pg.Pool,
  tenantId: string,
): EncompassUserSyncService {
  return new EncompassUserSyncService(tenantPool, tenantId);
}
