/**
 * Management Database Schema
 * Stores tenant metadata, connection info, API keys, and subscriptions
 * This is the single source of truth for tenant configuration
 */

import pg from 'pg';

const { Pool } = pg;

// Management database connection pool (separate from tenant databases)
let managementPool: pg.Pool | null = null;
let poolLastHealthCheck = 0;
let poolHealthy = true;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

function createManagementPool(): pg.Pool {
  const dbHost = (process.env.DB_HOST || 'localhost').trim();
  const rawHost = dbHost === 'localhost' || dbHost === '127.0.0.1' ? '127.0.0.1' : dbHost;
  
  const managementDbName = process.env.MANAGEMENT_DB_NAME || 'coheus_management';
  
  const newPool = new Pool({
    host: rawHost,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: managementDbName,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: rawHost !== '127.0.0.1' && rawHost !== 'localhost' ? { rejectUnauthorized: false } : false,
    max: 20, // Increased pool size
    min: 2, // Keep minimum connections alive
    idleTimeoutMillis: 60000, // 60 seconds idle timeout
    connectionTimeoutMillis: 10000, // 10 seconds connection timeout (faster fail)
    allowExitOnIdle: false, // Keep pool alive
  });

  newPool.on('error', (err: any) => {
    console.error('[ManagementDB] Pool error:', err.message);
    poolHealthy = false;
  });
  
  newPool.on('connect', () => {
    poolHealthy = true;
  });

  console.log(`[ManagementDB] Created pool for database: ${managementDbName} at ${rawHost}`);
  return newPool;
}

function getManagementPool(): pg.Pool {
  if (!managementPool) {
    managementPool = createManagementPool();
    poolLastHealthCheck = Date.now();
    poolHealthy = true;
  }
  return managementPool;
}

/**
 * Check pool health and recreate if necessary
 */
async function ensurePoolHealth(): Promise<void> {
  const now = Date.now();
  
  // Only check health periodically to avoid overhead
  if (now - poolLastHealthCheck < HEALTH_CHECK_INTERVAL && poolHealthy) {
    return;
  }
  
  poolLastHealthCheck = now;
  
  if (!managementPool) {
    managementPool = createManagementPool();
    return;
  }
  
  try {
    // Quick health check with short timeout
    const client = await Promise.race([
      managementPool.connect(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), 3000)
      )
    ]);
    
    try {
      await client.query('SELECT 1');
      poolHealthy = true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[ManagementDB] Health check failed, recreating pool:', err.message);
    poolHealthy = false;
    
    // Close old pool and create new one
    try {
      await managementPool.end();
    } catch (closeErr) {
      // Ignore close errors
    }
    
    managementPool = createManagementPool();
    poolHealthy = true;
  }
}

/**
 * Execute a query with automatic retry on connection failure
 */
async function queryWithRetry<T>(
  queryFn: (pool: pg.Pool) => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await ensurePoolHealth();
      return await queryFn(getManagementPool());
    } catch (err: any) {
      lastError = err;
      
      // Check if this is a connection error that might benefit from retry
      const isConnectionError = 
        err.code === 'ECONNREFUSED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.message?.includes('timeout') ||
        err.message?.includes('Connection terminated');
      
      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[ManagementDB] Connection error (attempt ${attempt + 1}/${maxRetries + 1}):`, err.message);
        poolHealthy = false;
        
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
        continue;
      }
      
      throw err;
    }
  }
  
  throw lastError || new Error('Query failed after retries');
}

// Create a wrapper pool that includes retry logic
export const pool = {
  query: async (text: string | pg.QueryConfig, values?: any[]): Promise<pg.QueryResult> => {
    return queryWithRetry(p => p.query(text as string, values));
  },
  connect: async (): Promise<pg.PoolClient> => {
    await ensurePoolHealth();
    return getManagementPool().connect();
  },
  end: async (): Promise<void> => {
    if (managementPool) {
      await managementPool.end();
      managementPool = null;
    }
  },
  // Expose raw pool for cases that need it
  get _pool() {
    return getManagementPool();
  }
} as unknown as pg.Pool;

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
