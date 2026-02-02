/**
 * Tenant Provisioning Service
 * Handles creation and management of tenant databases
 */

import pg from 'pg';
import { pool as managementPool } from '../config/managementDatabase.js';
import { createTenantDatabaseSchema } from '../config/tenantDatabaseSchema.js';
import { encryptField } from './encryption.js';

const { Pool } = pg;

export interface CreateTenantOptions {
  name: string;
  slug: string;
  deployment_type: 'cloud' | 'on_premise' | 'per_lender_aws';
  // For cloud deployment, these are optional - we use the shared Aurora cluster
  database_host?: string;
  database_port?: number;
  database_user?: string;
  database_password?: string;
  aws_account_id?: string;
  rds_instance_id?: string;
}

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  database_name: string;
  status: string;
  deployment_type: string;
  created_at: Date;
}

/**
 * Create a new tenant and provision their database
 */
export async function createTenant(options: CreateTenantOptions): Promise<TenantInfo> {
  const client = await managementPool.connect();
  
  try {
    await client.query('BEGIN');

    // Generate database name
    const databaseName = `coheus_tenant_${options.slug.replace(/[^a-z0-9]/g, '_')}`;

    // For cloud deployments, use the shared Aurora cluster credentials from environment
    let dbHost = options.database_host;
    let dbPort = options.database_port || 5432;
    let dbUser = options.database_user;
    let dbPassword = options.database_password;

    if (options.deployment_type === 'cloud') {
      // Use the same Aurora cluster as the management database
      dbHost = process.env.DB_HOST;
      dbPort = parseInt(process.env.DB_PORT || '5432');
      dbUser = process.env.DB_USER;
      dbPassword = process.env.DB_PASSWORD;

      if (!dbHost || !dbUser || !dbPassword) {
        throw new Error('Cloud deployment requires DB_HOST, DB_USER, and DB_PASSWORD environment variables');
      }

      console.log(`[TenantProvisioning] Using shared Aurora cluster: ${dbHost}`);
    } else if (!dbHost || !dbUser || !dbPassword) {
      throw new Error('Non-cloud deployments require database_host, database_user, and database_password');
    }

    // Encrypt database password for storage
    const encryptedPassword = await encryptField(dbPassword);

    // Insert tenant record
    const insertResult = await client.query(
      `INSERT INTO coheus_tenants (
        name, slug, database_name, database_host, database_port,
        database_user, database_password_encrypted, deployment_type,
        aws_account_id, rds_instance_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'provisioning')
      RETURNING id, name, slug, database_name, status, deployment_type, created_at`,
      [
        options.name,
        options.slug,
        databaseName,
        dbHost,
        dbPort,
        dbUser,
        encryptedPassword,
        options.deployment_type,
        options.aws_account_id || null,
        options.rds_instance_id || null,
      ]
    );

    const tenant = insertResult.rows[0];

    // Create tenant database on the target host
    await createTenantDatabase(
      databaseName,
      dbUser!,
      dbPassword!,
      dbHost!,
      dbPort
    );

    // Create tenant database schema
    // Use SSL for non-local hosts (Aurora requires SSL)
    const isLocalHost = dbHost === 'localhost' || dbHost === '127.0.0.1';
    const tenantPool = new Pool({
      host: dbHost,
      port: dbPort,
      database: databaseName,
      user: dbUser,
      password: dbPassword,
      ssl: isLocalHost ? false : { rejectUnauthorized: false },
    });

    try {
      await createTenantDatabaseSchema(tenantPool);
    } finally {
      await tenantPool.end();
    }

    // Update tenant status to active
    await client.query(
      `UPDATE coheus_tenants SET status = 'active' WHERE id = $1`,
      [tenant.id]
    );

    await client.query('COMMIT');

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      database_name: tenant.database_name,
      status: 'active',
      deployment_type: tenant.deployment_type,
      created_at: tenant.created_at,
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[TenantProvisioning] Error creating tenant:', error);
    throw new Error(`Failed to create tenant: ${error.message}`);
  } finally {
    client.release();
  }
}

/**
 * Create tenant database (PostgreSQL database)
 */
async function createTenantDatabase(
  databaseName: string,
  dbUser: string,
  dbPassword: string,
  dbHost: string,
  dbPort: number
): Promise<void> {
  // Connect to postgres database to create new database
  const isLocalHost = dbHost === 'localhost' || dbHost === '127.0.0.1';
  
  console.log(`[TenantProvisioning] Creating database ${databaseName} on ${dbHost}:${dbPort}`);
  
  const adminPool = new Pool({
    host: dbHost,
    port: dbPort,
    database: 'postgres',
    user: dbUser,
    password: dbPassword,
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    // Check if database exists
    const checkResult = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName]
    );

    if (checkResult.rows.length === 0) {
      // Create database - use quoted identifier to handle special characters
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`[TenantProvisioning] Created database: ${databaseName}`);
    } else {
      console.log(`[TenantProvisioning] Database already exists: ${databaseName}`);
    }
  } finally {
    await adminPool.end();
  }
}

/**
 * Get tenant by ID
 */
export async function getTenant(tenantId: string): Promise<TenantInfo | null> {
  const result = await managementPool.query(
    `SELECT id, name, slug, database_name, status, deployment_type, created_at
     FROM coheus_tenants
     WHERE id = $1`,
    [tenantId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    database_name: row.database_name,
    status: row.status,
    deployment_type: row.deployment_type,
    created_at: row.created_at,
  };
}

/**
 * Get tenant by slug
 */
export async function getTenantBySlug(slug: string): Promise<TenantInfo | null> {
  const result = await managementPool.query(
    `SELECT id, name, slug, database_name, status, deployment_type, created_at
     FROM coheus_tenants
     WHERE slug = $1`,
    [slug]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    database_name: row.database_name,
    status: row.status,
    deployment_type: row.deployment_type,
    created_at: row.created_at,
  };
}

/**
 * List all tenants
 */
export async function listTenants(): Promise<TenantInfo[]> {
  const result = await managementPool.query(
    `SELECT id, name, slug, database_name, status, deployment_type, created_at
     FROM coheus_tenants
     WHERE status != 'deleted'
     ORDER BY created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    database_name: row.database_name,
    status: row.status,
    deployment_type: row.deployment_type,
    created_at: row.created_at,
  }));
}

/**
 * Update tenant status
 */
export async function updateTenantStatus(
  tenantId: string,
  status: 'active' | 'suspended' | 'deleted' | 'provisioning'
): Promise<void> {
  await managementPool.query(
    `UPDATE coheus_tenants SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, tenantId]
  );
}

/**
 * Delete tenant (soft delete)
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  await updateTenantStatus(tenantId, 'deleted');
}
