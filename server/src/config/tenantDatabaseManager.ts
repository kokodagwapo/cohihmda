/**
 * Tenant Database Manager
 * Manages connection pools for tenant-specific databases
 * Each lender/client has their own database with complete data isolation
 */

import pg from 'pg';
import { pool as managementPool } from './managementDatabase.js';
import { decryptField } from '../services/encryption.js';
import { createTenantDatabaseSchema } from './tenantDatabaseSchema.js';

const { Pool } = pg;

export interface TenantDatabaseConfig {
  id: string;
  name: string;
  slug: string;
  database_name: string;
  database_host: string;
  database_port: number;
  database_user: string;
  database_password: string;
  status: string;
  deployment_type: string;
}

interface CachedPool {
  pool: pg.Pool;
  lastAccessed: number;
  schemaEnsured: boolean;
  failureCount: number;
}

class TenantDatabaseManager {
  private tenantPools: Map<string, CachedPool> = new Map();
  private maxPoolCacheSize = 50; // Max pools to cache
  private poolIdleTimeout = 30 * 60 * 1000; // 30 minutes
  private maxFailureCount = 3; // Max failures before evicting pool

  /**
   * Get tenant database configuration from management database
   * Includes retry logic for transient connection failures
   */
  async getTenantConfig(tenantId: string, retries = 2): Promise<TenantDatabaseConfig> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await managementPool.query(
          `SELECT 
            id, name, slug, database_name, database_host, database_port,
            database_user, database_password_encrypted, status, deployment_type
          FROM coheus_tenants 
          WHERE id = $1 AND status = 'active'`,
          [tenantId]
        );

        if (result.rows.length === 0) {
          throw new Error(`Tenant ${tenantId} not found or inactive`);
        }

        const tenant = result.rows[0];
        
        // Decrypt password
        const password = await decryptField(tenant.database_password_encrypted) || tenant.database_password_encrypted;

        return {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          database_name: tenant.database_name,
          database_host: tenant.database_host,
          database_port: tenant.database_port,
          database_user: tenant.database_user,
          database_password: password,
          status: tenant.status,
          deployment_type: tenant.deployment_type,
        };
      } catch (err: any) {
        lastError = err;
        
        // Check if this is a connection error worth retrying
        const isConnectionError = 
          err.code === 'ECONNREFUSED' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ETIMEDOUT' ||
          err.message?.includes('timeout') ||
          err.message?.includes('Connection terminated');
        
        if (isConnectionError && attempt < retries) {
          console.warn(`[TenantDB] Connection error getting tenant config (attempt ${attempt + 1}/${retries + 1}):`, err.message);
          // Brief delay before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt)));
          continue;
        }
        
        throw err;
      }
    }
    
    throw lastError || new Error(`Failed to get tenant config for ${tenantId}`);
  }

  /**
   * Get or create tenant database pool
   * Validates connection health and auto-recovers from stale pools
   */
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // Check cache first
    const cached = this.tenantPools.get(tenantId);
    if (cached) {
      // Validate the connection is still healthy
      const isHealthy = await this.validatePoolHealth(cached.pool, tenantId);
      
      if (!isHealthy) {
        cached.failureCount++;
        console.warn(`[TenantDB] Pool health check failed for tenant ${tenantId} (failure ${cached.failureCount}/${this.maxFailureCount})`);
        
        // If too many failures, evict and recreate
        if (cached.failureCount >= this.maxFailureCount) {
          console.log(`[TenantDB] Evicting unhealthy pool for tenant ${tenantId}`);
          await this.evictPool(tenantId);
          // Fall through to create new pool
        } else {
          // Try to use the pool anyway, it might recover
          cached.lastAccessed = Date.now();
          return cached.pool;
        }
      } else {
        // Reset failure count on success
        cached.failureCount = 0;
        cached.lastAccessed = Date.now();
        
        // Ensure schema is applied (only once per pool lifecycle)
        if (!cached.schemaEnsured) {
          await this.ensureSchema(cached.pool, tenantId);
          cached.schemaEnsured = true;
        }
        
        return cached.pool;
      }
    }

    // Get tenant config
    const config = await this.getTenantConfig(tenantId);

    // Evict old pools if cache is full
    if (this.tenantPools.size >= this.maxPoolCacheSize) {
      this.evictOldestPool();
    }

    // Determine SSL requirement
    const isLocalHost = config.database_host === 'localhost' || 
                       config.database_host === '127.0.0.1' ||
                       config.database_host.startsWith('172.') ||
                       config.database_host.startsWith('10.');
    const sslEnabled = !isLocalHost;

    // Create pool for tenant database with balanced settings
    const pool = new Pool({
      host: config.database_host,
      port: config.database_port,
      database: config.database_name,
      user: config.database_user,
      password: config.database_password,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 15, // Reasonable max connections per tenant
      min: 1, // Keep at least one connection alive
      idleTimeoutMillis: 30000, // 30 seconds idle timeout (balanced)
      connectionTimeoutMillis: 8000, // 8 seconds connection timeout (fast fail)
      allowExitOnIdle: false, // Keep pool alive to avoid reconnection overhead
    });

    // Handle pool errors - mark for eviction on critical errors
    pool.on('error', (err: any) => {
      console.error(`[TenantDB] Pool error for tenant ${tenantId}:`, {
        message: err.message,
        code: err.code,
        database: config.database_name,
      });
      
      // Increment failure count for connection-related errors
      const cached = this.tenantPools.get(tenantId);
      if (cached && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        cached.failureCount++;
      }
    });

    // Set timezone on connection
    pool.on('connect', async (client) => {
      try {
        await client.query('SET timezone = UTC');
      } catch (err) {
        console.warn(`[TenantDB] Failed to set timezone for tenant ${tenantId}:`, err);
      }
    });

    // Test the connection before caching
    const isHealthy = await this.validatePoolHealth(pool, tenantId);
    if (!isHealthy) {
      console.error(`[TenantDB] Failed to establish initial connection for tenant ${tenantId}`);
      await pool.end().catch(() => {});
      throw new Error(`Failed to connect to tenant database ${config.database_name}`);
    }

    // Ensure schema is up to date (creates tables if missing)
    await this.ensureSchema(pool, tenantId);

    // Cache pool
    this.tenantPools.set(tenantId, {
      pool,
      lastAccessed: Date.now(),
      schemaEnsured: true,
      failureCount: 0,
    });

    console.log(`[TenantDB] Created pool for tenant ${tenantId} (${config.database_name})`);
    return pool;
  }

  /**
   * Validate pool health with a simple query
   * Returns true if the connection is healthy, false otherwise
   */
  private async validatePoolHealth(pool: pg.Pool, tenantId: string): Promise<boolean> {
    try {
      // Use a very short timeout for health check (2 seconds)
      const client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 2000)
        )
      ]);
      
      try {
        // Quick ping query
        await Promise.race([
          client.query('SELECT 1'),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Query timeout')), 1000)
          )
        ]);
        return true;
      } finally {
        client.release();
      }
    } catch (error: any) {
      // Only log if it's not a routine timeout (reduce noise)
      if (!error.message?.includes('timeout')) {
        console.warn(`[TenantDB] Health check failed for tenant ${tenantId}:`, error.message);
      }
      return false;
    }
  }

  /**
   * Evict a specific pool from cache
   */
  async evictPool(tenantId: string): Promise<void> {
    const cached = this.tenantPools.get(tenantId);
    if (cached) {
      try {
        await cached.pool.end();
      } catch (err) {
        console.warn(`[TenantDB] Error closing pool for tenant ${tenantId}:`, err);
      }
      this.tenantPools.delete(tenantId);
      console.log(`[TenantDB] Evicted pool for tenant ${tenantId}`);
    }
  }

  /**
   * Ensure tenant database schema is up to date
   * This runs the CREATE TABLE IF NOT EXISTS statements to add any missing tables
   */
  private async ensureSchema(pool: pg.Pool, tenantId: string): Promise<void> {
    try {
      console.log(`[TenantDB] Ensuring schema for tenant ${tenantId}...`);
      await createTenantDatabaseSchema(pool);
      console.log(`[TenantDB] Schema ensured for tenant ${tenantId}`);
    } catch (error: any) {
      console.error(`[TenantDB] Error ensuring schema for tenant ${tenantId}:`, error.message);
      // Don't throw - we still want to return the pool even if schema update fails
      // The schema updates use IF NOT EXISTS so failures usually mean partial success
    }
  }

  /**
   * Evict oldest pool from cache
   */
  private evictOldestPool(): void {
    let oldestTenantId: string | null = null;
    let oldestTime = Date.now();

    for (const [tenantId, cached] of this.tenantPools.entries()) {
      if (cached.lastAccessed < oldestTime) {
        oldestTime = cached.lastAccessed;
        oldestTenantId = tenantId;
      }
    }

    if (oldestTenantId) {
      this.evictPool(oldestTenantId).catch(() => {});
    }
  }

  /**
   * Close all tenant pools
   */
  async closeAllTenantPools(): Promise<void> {
    const closePromises = Array.from(this.tenantPools.entries()).map(
      async ([tenantId, cached]) => {
        try {
          await cached.pool.end();
          console.log(`[TenantDB] Closed pool for tenant ${tenantId}`);
        } catch (err) {
          console.warn(`[TenantDB] Error closing pool for tenant ${tenantId}:`, err);
        }
      }
    );

    await Promise.all(closePromises);
    this.tenantPools.clear();
  }

  /**
   * Clean up idle pools (called periodically)
   */
  async cleanupIdlePools(): Promise<void> {
    const now = Date.now();
    const tenantsToEvict: string[] = [];

    for (const [tenantId, cached] of this.tenantPools.entries()) {
      // Evict if idle for too long or has too many failures
      if (now - cached.lastAccessed > this.poolIdleTimeout || cached.failureCount >= this.maxFailureCount) {
        tenantsToEvict.push(tenantId);
      }
    }

    for (const tenantId of tenantsToEvict) {
      await this.evictPool(tenantId);
      console.log(`[TenantDB] Cleaned up idle/unhealthy pool for tenant ${tenantId}`);
    }
  }

  /**
   * Force refresh a tenant pool (useful after hot reload or connection issues)
   */
  async refreshTenantPool(tenantId: string): Promise<pg.Pool> {
    console.log(`[TenantDB] Force refreshing pool for tenant ${tenantId}`);
    await this.evictPool(tenantId);
    return this.getTenantPool(tenantId);
  }

  /**
   * Get pool stats for debugging
   */
  getPoolStats(): { tenantId: string; lastAccessed: number; failureCount: number; age: number }[] {
    const now = Date.now();
    return Array.from(this.tenantPools.entries()).map(([tenantId, cached]) => ({
      tenantId,
      lastAccessed: cached.lastAccessed,
      failureCount: cached.failureCount,
      age: now - cached.lastAccessed,
    }));
  }

  /**
   * Get tenant ID from user ID
   */
  async getTenantIdFromUserId(userId: string): Promise<string | null> {
    // First check management DB for user's tenant association
    // Users table might be in management DB or we need to check tenant DBs
    // For now, we'll need to check profiles in management DB or tenant DBs
    
    // TODO: This needs to be implemented based on where user data is stored
    // For now, return null and let the caller handle it
    return null;
  }
}

// Singleton instance
export const tenantDbManager = new TenantDatabaseManager();

// Cleanup idle/unhealthy pools every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    tenantDbManager.cleanupIdlePools().catch((err) => {
      console.warn('[TenantDB] Error cleaning up idle pools:', err);
    });
  }, 5 * 60 * 1000); // 5 minutes

  // Log pool stats every 10 minutes for debugging
  setInterval(() => {
    const stats = tenantDbManager.getPoolStats();
    if (stats.length > 0) {
      console.log(`[TenantDB] Pool stats: ${stats.length} pools cached`);
      stats.forEach(s => {
        if (s.failureCount > 0 || s.age > 10 * 60 * 1000) {
          console.log(`  - ${s.tenantId}: age=${Math.round(s.age / 1000)}s, failures=${s.failureCount}`);
        }
      });
    }
  }, 10 * 60 * 1000); // 10 minutes
}
