/**
 * Tenant Database Manager
 * Manages connection pools for tenant-specific databases
 * Each lender/client has their own database with complete data isolation
 */

import pg from 'pg';
import { pool as managementPool } from './managementDatabase.js';
import { decryptField } from '../services/encryption.js';

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
}

class TenantDatabaseManager {
  private tenantPools: Map<string, CachedPool> = new Map();
  private maxPoolCacheSize = 50; // Max pools to cache
  private poolIdleTimeout = 30 * 60 * 1000; // 30 minutes

  /**
   * Get tenant database configuration from management database
   */
  async getTenantConfig(tenantId: string): Promise<TenantDatabaseConfig> {
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
  }

  /**
   * Get or create tenant database pool
   */
  async getTenantPool(tenantId: string): Promise<pg.Pool> {
    // Check cache first
    const cached = this.tenantPools.get(tenantId);
    if (cached) {
      // Update last accessed time
      cached.lastAccessed = Date.now();
      return cached.pool;
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

    // Create pool for tenant database
    const pool = new Pool({
      host: config.database_host,
      port: config.database_port,
      database: config.database_name,
      user: config.database_user,
      password: config.database_password,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      allowExitOnIdle: false,
    });

    // Handle pool errors
    pool.on('error', (err: any) => {
      console.error(`[TenantDB] Pool error for tenant ${tenantId}:`, {
        message: err.message,
        code: err.code,
        database: config.database_name,
      });
    });

    // Set timezone on connection
    pool.on('connect', async (client) => {
      try {
        await client.query('SET timezone = UTC');
      } catch (err) {
        console.warn(`[TenantDB] Failed to set timezone for tenant ${tenantId}:`, err);
      }
    });

    // Cache pool
    this.tenantPools.set(tenantId, {
      pool,
      lastAccessed: Date.now(),
    });

    console.log(`[TenantDB] Created pool for tenant ${tenantId} (${config.database_name})`);
    return pool;
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
      const cached = this.tenantPools.get(oldestTenantId);
      if (cached) {
        cached.pool.end().catch((err) => {
          console.warn(`[TenantDB] Error closing pool for tenant ${oldestTenantId}:`, err);
        });
        this.tenantPools.delete(oldestTenantId);
        console.log(`[TenantDB] Evicted pool for tenant ${oldestTenantId}`);
      }
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
      if (now - cached.lastAccessed > this.poolIdleTimeout) {
        tenantsToEvict.push(tenantId);
      }
    }

    for (const tenantId of tenantsToEvict) {
      const cached = this.tenantPools.get(tenantId);
      if (cached) {
        await cached.pool.end().catch(() => {});
        this.tenantPools.delete(tenantId);
        console.log(`[TenantDB] Cleaned up idle pool for tenant ${tenantId}`);
      }
    }
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

// Cleanup idle pools every 15 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    tenantDbManager.cleanupIdlePools().catch((err) => {
      console.warn('[TenantDB] Error cleaning up idle pools:', err);
    });
  }, 15 * 60 * 1000);
}
