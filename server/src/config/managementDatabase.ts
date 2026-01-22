/**
 * Management Database Schema
 * Stores tenant metadata, connection info, API keys, and subscriptions
 * This is the single source of truth for tenant configuration
 */

import pg from 'pg';

const { Pool } = pg;

// Management database connection pool (separate from tenant databases)
let managementPool: pg.Pool | null = null;

function getManagementPool(): pg.Pool {
  if (!managementPool) {
    const dbHost = (process.env.DB_HOST || 'localhost').trim();
    const rawHost = dbHost === 'localhost' || dbHost === '127.0.0.1' ? '127.0.0.1' : dbHost;
    
    const managementDbName = process.env.MANAGEMENT_DB_NAME || 'coheus_management';
    
    managementPool = new Pool({
      host: rawHost,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: managementDbName,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      ssl: rawHost !== '127.0.0.1' && rawHost !== 'localhost' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    });

    managementPool.on('error', (err: any) => {
      console.error('[ManagementDB] Pool error:', err);
    });
  }
  return managementPool;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return getManagementPool()[prop as keyof pg.Pool];
  }
}) as pg.Pool;

/**
 * Initialize management database schema
 * This should be run once when setting up the system
 */
export async function initManagementDatabase(): Promise<void> {
  try {
    console.log('🔧 Initializing management database schema...');
    
    const pool = getManagementPool();

    // Create tenants registry table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coheus_tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        database_name TEXT UNIQUE NOT NULL,
        database_host TEXT NOT NULL,
        database_port INTEGER DEFAULT 5432,
        database_user TEXT NOT NULL,
        database_password_encrypted TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted', 'provisioning')),
        deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws')),
        aws_account_id TEXT,
        rds_instance_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coheus_tenants_slug ON coheus_tenants(slug)
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coheus_tenants_status ON coheus_tenants(status)
    `).catch(() => {});

    // Note: LOS connections are stored in tenant databases, not management database
    // Management database only stores tenant metadata and user-tenant mappings

    // Create tenant API keys table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
        openai_api_key_encrypted TEXT,
        gemini_api_key_encrypted TEXT,
        other_keys_encrypted JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id)
    `).catch(() => {});

    // Create tenant subscriptions table (moved from tenant DBs)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
        plan_id UUID,
        plan_name TEXT,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'paused')),
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws', 'hybrid')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id)
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_stripe ON tenant_subscriptions(stripe_subscription_id)
      WHERE stripe_subscription_id IS NOT NULL
    `).catch(() => {});

    // Create tenant deployments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
        deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws')),
        instance_type TEXT,
        instance_name TEXT,
        cloud_provider TEXT,
        cloud_region TEXT,
        aws_account_id TEXT,
        rds_instance_id TEXT,
        ip_address TEXT,
        hostname TEXT,
        version TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'syncing', 'offline', 'error')),
        last_sync_at TIMESTAMPTZ,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_deployments_tenant ON tenant_deployments(tenant_id)
    `).catch(() => {});

    // Create user-tenant mapping table (maps users to tenants in management DB)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tenant_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
        role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor')),
        is_primary BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, tenant_id)
      )
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_user ON user_tenant_mappings(user_id)
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_tenant ON user_tenant_mappings(tenant_id)
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_primary ON user_tenant_mappings(user_id, is_primary)
      WHERE is_primary = true
    `).catch(() => {});

    console.log('✅ Management database schema initialized');
  } catch (error: any) {
    console.error('❌ Error initializing management database:', error);
    throw error;
  }
}
