/**
 * Database Connection Helper for Lambda Functions
 * Provides RDS PostgreSQL connection pooling for Lambda functions
 */

import * as pg from 'pg';
const { Pool } = pg;

// Connection pool (reused across invocations)
let poolInstance: pg.Pool | null = null;

/**
 * Get or create database connection pool
 * Lambda functions reuse connections across invocations
 */
export function getPool(): pg.Pool {
  if (!poolInstance) {
    const dbConfig = {
      host: process.env.DB_HOST || process.env.RDS_HOSTNAME,
      port: parseInt(process.env.DB_PORT || process.env.RDS_PORT || '5432'),
      database: process.env.DB_NAME || process.env.RDS_DB_NAME || 'coheus',
      user: process.env.DB_USER || process.env.RDS_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || process.env.RDS_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 2, // Lambda functions should use minimal connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    if (!dbConfig.password) {
      throw new Error('Database password not configured. Set DB_PASSWORD or RDS_PASSWORD environment variable.');
    }

    poolInstance = new Pool(dbConfig);
    
    // Handle pool errors
    poolInstance.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }

  return poolInstance;
}

/**
 * Execute a query
 * @param text - SQL query
 * @param params - Query parameters
 * @returns Query result
 */
export async function query(text: string, params?: any[]): Promise<pg.QueryResult> {
  const pool = getPool();
  return pool.query(text, params);
}

/**
 * Close the database pool (for cleanup)
 */
export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
