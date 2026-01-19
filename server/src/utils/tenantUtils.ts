import { pool } from '../config/database.js';

/**
 * Helper function to get tenant ID (supports super admins and auto-creates tenant if needed)
 * 
 * Resolution order:
 * 1. If queryTenantId is provided, use it
 * 2. Get tenant_id from user profile
 * 3. If user is super_admin, use Default Tenant
 * 4. If no tenant exists, create one automatically
 * 
 * @param userId - The user ID to look up
 * @param queryTenantId - Optional tenant ID from query parameters
 * @param autoCreate - If true, automatically create a tenant if none exists (default: true)
 * @returns Tenant ID or null if not found and autoCreate is false
 */
export async function getTenantId(
  userId: string,
  queryTenantId?: string,
  autoCreate: boolean = true
): Promise<string | null> {
  // Check if tenant_id was provided in query
  if (queryTenantId) {
    return queryTenantId;
  }

  // Try to get from user profile
  let profileResult = await pool.query(
    'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
    [userId]
  );

  // Create profile if it doesn't exist
  if (profileResult.rows.length === 0) {
    await pool.query(
      'INSERT INTO public.profiles (user_id, created_at) VALUES ($1, NOW())',
      [userId]
    );
    // Re-fetch profile after creation
    profileResult = await pool.query(
      'SELECT tenant_id FROM public.profiles WHERE user_id = $1',
      [userId]
    );
  }

  if (profileResult.rows[0]?.tenant_id) {
    return profileResult.rows[0].tenant_id;
  }

  // If still no tenant, check if user is super admin and use Default Tenant
  const userResult = await pool.query(
    'SELECT role, email FROM public.users WHERE id = $1',
    [userId]
  );

  if (userResult.rows[0]?.role === 'super_admin') {
    const defaultTenantResult = await pool.query(
      `SELECT id FROM public.tenants WHERE name = 'Default Tenant' LIMIT 1`
    );
    if (defaultTenantResult.rows.length > 0) {
      const defaultTenantId = defaultTenantResult.rows[0].id;
      // Update profile with default tenant
      await pool.query(
        'UPDATE public.profiles SET tenant_id = $1 WHERE user_id = $2',
        [defaultTenantId, userId]
      );
      return defaultTenantId;
    }
  }

  // Auto-create tenant if enabled and no tenant found
  if (autoCreate) {
    try {
      const userEmail = userResult.rows[0]?.email || `user-${userId}@coheus.com`;
      
      // Create a default tenant for the user
      const tenantResult = await pool.query(
        `INSERT INTO public.tenants (name, created_at)
         VALUES ($1, NOW())
         RETURNING id`,
        [`Tenant for ${userEmail}`]
      );

      const tenantId = tenantResult.rows[0].id;

      // Update profile with tenant_id
      await pool.query(
        'UPDATE public.profiles SET tenant_id = $1 WHERE user_id = $2',
        [tenantId, userId]
      );

      return tenantId;
    } catch (error) {
      console.error('Error auto-creating tenant:', error);
      // Return null if creation fails
      return null;
    }
  }

  return null;
}

