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
    console.error('[ManagementDB] Pool error:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      database: managementDbName,
    });
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
 * Check if management database schema has been initialized via migrations
 * Returns the current migration version or null if no migrations have been applied
 */
export async function checkMigrationStatus(): Promise<{ version: string | null; isInitialized: boolean }> {
  try {
    const pool = getManagementPool();
    
    // Check if schema_migrations table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      return { version: null, isInitialized: false };
    }
    
    // Get latest migration version
    const versionResult = await pool.query(`
      SELECT version FROM schema_migrations 
      ORDER BY version DESC 
      LIMIT 1
    `);
    
    if (versionResult.rows.length === 0) {
      return { version: null, isInitialized: false };
    }
    
    return { 
      version: versionResult.rows[0].version, 
      isInitialized: true 
    };
  } catch (error: any) {
    // If we can't connect or query, schema is not initialized
    console.warn('[ManagementDB] Migration status check failed:', error.message);
    return { version: null, isInitialized: false };
  }
}

/**
 * Check if core tables exist (for backwards compatibility during migration transition)
 */
export async function checkCoreTablesExist(): Promise<boolean> {
  try {
    const pool = getManagementPool();
    
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('coheus_tenants', 'coheus_users')
    `);
    
    return parseInt(result.rows[0].count) >= 2;
  } catch (error: any) {
    console.warn('[ManagementDB] Core tables check failed:', error.message);
    return false;
  }
}

/**
 * @deprecated Use migration system instead. Run: npm run migrate
 * 
 * This function is kept for backwards compatibility but should not be used.
 * Schema should be managed via migrations in server/migrations/management/
 */
export async function initManagementDatabase(): Promise<void> {
  console.warn('⚠️  initManagementDatabase() is deprecated. Use migration system instead:');
  console.warn('    npm run migrate');
  console.warn('');
  console.warn('    See: server/migrations/management/ for migration files');
  
  // Check if migrations have been applied
  const status = await checkMigrationStatus();
  
  if (status.isInitialized) {
    console.log(`✅ Management database already initialized via migrations (version: ${status.version})`);
    return;
  }
  
  // If no migrations applied, show error and instructions
  console.error('❌ Management database not initialized. Run migrations:');
  console.error('');
  console.error('    cd server');
  console.error('    npm run migrate');
  console.error('');
  throw new Error('Management database not initialized. Run migrations first.');
}
