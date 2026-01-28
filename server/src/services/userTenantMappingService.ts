/**
 * User-Tenant Mapping Service
 * Maps users to tenants in the management database
 * This allows users to belong to tenants and access tenant-specific resources
 */

import { pool as managementPool } from '../config/managementDatabase.js';

export interface UserTenantMapping {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  is_primary: boolean;
  created_at: Date;
}

/**
 * Get tenant ID for a user
 * Returns the primary tenant if user has multiple tenants
 */
export async function getTenantIdForUser(userId: string): Promise<string | null> {
  try {
    const result = await managementPool.query(
      `SELECT tenant_id 
       FROM user_tenant_mappings 
       WHERE user_id = $1 AND is_primary = true
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length > 0) {
      return result.rows[0].tenant_id;
    }

    // If no primary tenant, get any tenant
    const anyResult = await managementPool.query(
      `SELECT tenant_id 
       FROM user_tenant_mappings 
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    return anyResult.rows.length > 0 ? anyResult.rows[0].tenant_id : null;
  } catch (error: any) {
    console.error('[UserTenantMapping] Error getting tenant for user:', error);
    return null;
  }
}

/**
 * Get all tenants for a user
 */
export async function getTenantsForUser(userId: string): Promise<UserTenantMapping[]> {
  try {
    const result = await managementPool.query(
      `SELECT id, user_id, tenant_id, role, is_primary, created_at
       FROM user_tenant_mappings 
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      role: row.role,
      is_primary: row.is_primary,
      created_at: row.created_at,
    }));
  } catch (error: any) {
    console.error('[UserTenantMapping] Error getting tenants for user:', error);
    return [];
  }
}

/**
 * Map a user to a tenant
 */
export async function mapUserToTenant(
  userId: string,
  tenantId: string,
  role: string = 'user',
  isPrimary: boolean = false
): Promise<UserTenantMapping> {
  // If setting as primary, unset other primary mappings for this user
  if (isPrimary) {
    await managementPool.query(
      `UPDATE user_tenant_mappings 
       SET is_primary = false 
       WHERE user_id = $1 AND is_primary = true`,
      [userId]
    );
  }

  // Insert or update mapping
  const result = await managementPool.query(
    `INSERT INTO user_tenant_mappings (user_id, tenant_id, role, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, tenant_id) 
     DO UPDATE SET role = EXCLUDED.role, is_primary = EXCLUDED.is_primary, updated_at = NOW()
     RETURNING id, user_id, tenant_id, role, is_primary, created_at`,
    [userId, tenantId, role, isPrimary]
  );

  return {
    id: result.rows[0].id,
    user_id: result.rows[0].user_id,
    tenant_id: result.rows[0].tenant_id,
    role: result.rows[0].role,
    is_primary: result.rows[0].is_primary,
    created_at: result.rows[0].created_at,
  };
}

/**
 * Remove user-tenant mapping
 */
export async function removeUserTenantMapping(userId: string, tenantId: string): Promise<void> {
  await managementPool.query(
    `DELETE FROM user_tenant_mappings 
     WHERE user_id = $1 AND tenant_id = $2`,
    [userId, tenantId]
  );
}

/**
 * Set primary tenant for a user
 */
export async function setPrimaryTenant(userId: string, tenantId: string): Promise<void> {
  const client = await managementPool.connect();
  try {
    await client.query('BEGIN');

    // Unset all primary mappings for this user
    await client.query(
      `UPDATE user_tenant_mappings 
       SET is_primary = false 
       WHERE user_id = $1`,
      [userId]
    );

    // Set the specified tenant as primary
    await client.query(
      `UPDATE user_tenant_mappings 
       SET is_primary = true, updated_at = NOW()
       WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
