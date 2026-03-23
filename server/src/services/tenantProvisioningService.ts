/**
 * Tenant Provisioning Service
 * Handles creation and management of tenant databases
 */

import pg from "pg";
import { pool as managementPool } from "../config/managementDatabase.js";
import { encryptField, decryptField } from "./encryption.js";
import { MigrationRunner, getMigrationsDir } from "../migrations/runner.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";

const { Pool } = pg;

export interface CreateTenantOptions {
  name: string;
  slug: string;
  deployment_type: "cloud" | "on_premise" | "per_lender_aws";
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
  updated_at?: Date;
  is_demo?: boolean;
  source_tenant_id?: string | null;
  source_tenant_name?: string | null;
  last_refreshed_at?: Date | null;
  auto_refresh?: boolean;
  created_at: Date;
}

/**
 * Create a new tenant and provision their database
 */
export async function createTenant(
  options: CreateTenantOptions,
): Promise<TenantInfo> {
  const client = await managementPool.connect();

  try {
    await client.query("BEGIN");

    // Generate database name
    const databaseName = `coheus_tenant_${options.slug.replace(
      /[^a-z0-9]/g,
      "_",
    )}`;

    // For cloud deployments, use the shared Aurora cluster credentials from environment
    let dbHost = options.database_host;
    let dbPort = options.database_port || 5432;
    let dbUser = options.database_user;
    let dbPassword = options.database_password;

    if (options.deployment_type === "cloud") {
      // Use the same Aurora cluster as the management database
      dbHost = process.env.DB_HOST;
      dbPort = parseInt(process.env.DB_PORT || "5432");
      dbUser = process.env.DB_USER;
      dbPassword = process.env.DB_PASSWORD;

      if (!dbHost || !dbUser || !dbPassword) {
        throw new Error(
          "Cloud deployment requires DB_HOST, DB_USER, and DB_PASSWORD environment variables",
        );
      }

      console.log(
        `[TenantProvisioning] Using shared Aurora cluster: ${dbHost}`,
      );
    } else if (!dbHost || !dbUser || !dbPassword) {
      throw new Error(
        "Non-cloud deployments require database_host, database_user, and database_password",
      );
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
      ],
    );

    const tenant = insertResult.rows[0];

    // Create tenant database on the target host
    await createTenantDatabase(
      databaseName,
      dbUser!,
      dbPassword!,
      dbHost!,
      dbPort,
    );

    // Create tenant database schema
    // Use SSL for non-local hosts (Aurora requires SSL)
    const isLocalHost = dbHost === "localhost" || dbHost === "127.0.0.1";
    const tenantPool = new Pool({
      host: dbHost,
      port: dbPort,
      database: databaseName,
      user: dbUser,
      password: dbPassword,
      ssl: isLocalHost ? false : { rejectUnauthorized: false },
    });

    try {
      // Run all tenant migrations to create the full schema from scratch.
      // Migrations are the single source of truth for the database schema.
      console.log(
        `[TenantProvisioning] Running tenant migrations for ${databaseName}...`,
      );
      const runner = new MigrationRunner(
        tenantPool,
        "tenant",
        databaseName,
        false,
      );
      const migrationsDir = getMigrationsDir("tenant");

      const { applied, errors } = await runner.runPendingMigrations(
        migrationsDir,
        {
          dryRun: false,
          force: false,
        },
      );

      if (errors.length > 0) {
        console.error(`[TenantProvisioning] Migration errors:`, errors);
        throw new Error(
          `Tenant migrations failed: ${errors.map((e) => e.error).join(", ")}`,
        );
      }

      console.log(
        `[TenantProvisioning] Applied ${applied.length} migration(s) to ${databaseName}`,
      );
    } finally {
      await tenantPool.end();
    }

    // Update tenant status to active
    await client.query(
      `UPDATE coheus_tenants SET status = 'active' WHERE id = $1`,
      [tenant.id],
    );

    await client.query("COMMIT");

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      database_name: tenant.database_name,
      status: "active",
      deployment_type: tenant.deployment_type,
      created_at: tenant.created_at,
    };
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("[TenantProvisioning] Error creating tenant:", error);
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
  dbPort: number,
): Promise<void> {
  // Connect to postgres database to create new database
  const isLocalHost = dbHost === "localhost" || dbHost === "127.0.0.1";

  console.log(
    `[TenantProvisioning] Creating database ${databaseName} on ${dbHost}:${dbPort}`,
  );

  const adminPool = new Pool({
    host: dbHost,
    port: dbPort,
    database: "postgres",
    user: dbUser,
    password: dbPassword,
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  try {
    // Check if database exists
    const checkResult = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName],
    );

    if (checkResult.rows.length === 0) {
      // Create database - use quoted identifier to handle special characters
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`[TenantProvisioning] Created database: ${databaseName}`);
    } else {
      console.log(
        `[TenantProvisioning] Database already exists: ${databaseName}`,
      );
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
    `SELECT t.id, t.name, t.slug, t.database_name, t.status, t.deployment_type,
            t.created_at, t.updated_at, t.is_demo, t.source_tenant_id,
            t.last_refreshed_at, t.auto_refresh, st.name AS source_tenant_name
     FROM coheus_tenants t
     LEFT JOIN coheus_tenants st ON st.id = t.source_tenant_id
     WHERE t.id = $1`,
    [tenantId],
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
    updated_at: row.updated_at,
    is_demo: row.is_demo ?? false,
    source_tenant_id: row.source_tenant_id ?? null,
    source_tenant_name: row.source_tenant_name ?? null,
    last_refreshed_at: row.last_refreshed_at ?? null,
    auto_refresh: row.auto_refresh ?? false,
    created_at: row.created_at,
  };
}

/**
 * Get tenant by slug
 */
export async function getTenantBySlug(
  slug: string,
): Promise<TenantInfo | null> {
  const result = await managementPool.query(
    `SELECT t.id, t.name, t.slug, t.database_name, t.status, t.deployment_type,
            t.created_at, t.updated_at, t.is_demo, t.source_tenant_id,
            t.last_refreshed_at, t.auto_refresh, st.name AS source_tenant_name
     FROM coheus_tenants t
     LEFT JOIN coheus_tenants st ON st.id = t.source_tenant_id
     WHERE t.slug = $1`,
    [slug],
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
    updated_at: row.updated_at,
    is_demo: row.is_demo ?? false,
    source_tenant_id: row.source_tenant_id ?? null,
    source_tenant_name: row.source_tenant_name ?? null,
    last_refreshed_at: row.last_refreshed_at ?? null,
    auto_refresh: row.auto_refresh ?? false,
    created_at: row.created_at,
  };
}

/**
 * List all tenants
 */
export async function listTenants(): Promise<TenantInfo[]> {
  const result = await managementPool.query(
    `SELECT t.id, t.name, t.slug, t.database_name, t.status, t.deployment_type,
            t.created_at, t.updated_at, t.is_demo, t.source_tenant_id,
            t.last_refreshed_at, t.auto_refresh, st.name AS source_tenant_name
     FROM coheus_tenants t
     LEFT JOIN coheus_tenants st ON st.id = t.source_tenant_id
     WHERE t.status != 'deleted'
     ORDER BY t.created_at DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    database_name: row.database_name,
    status: row.status,
    deployment_type: row.deployment_type,
    updated_at: row.updated_at,
    is_demo: row.is_demo ?? false,
    source_tenant_id: row.source_tenant_id ?? null,
    source_tenant_name: row.source_tenant_name ?? null,
    last_refreshed_at: row.last_refreshed_at ?? null,
    auto_refresh: row.auto_refresh ?? false,
    created_at: row.created_at,
  }));
}

/**
 * Update tenant status
 */
export async function updateTenantStatus(
  tenantId: string,
  status: "active" | "suspended" | "deleted" | "provisioning",
): Promise<void> {
  await managementPool.query(
    `UPDATE coheus_tenants SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, tenantId],
  );
}

/**
 * Delete tenant completely — drops the tenant database and removes the row
 * from the management database (cascading to related tables).
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  // 1. Fetch the tenant row (including DB connection info) before deleting it
  const tenantRow = await managementPool.query(
    `SELECT id, slug, database_name, database_host, database_port,
            database_user, database_password_encrypted, deployment_type
     FROM coheus_tenants WHERE id = $1`,
    [tenantId],
  );

  if (tenantRow.rows.length === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const tenant = tenantRow.rows[0];

  console.log(
    `[TenantProvisioning] Deleting tenant ${tenantId} (slug: ${tenant.slug}, db: ${tenant.database_name})`,
  );

  // 2. Evict the tenant's connection pool so no new queries can run
  try {
    await tenantDbManager.evictPool(tenantId);
    console.log(
      `[TenantProvisioning] Evicted connection pool for tenant ${tenantId}`,
    );
  } catch (err: any) {
    console.warn(
      `[TenantProvisioning] Could not evict pool (may not exist): ${err.message}`,
    );
  }

  // 3. Drop the tenant database
  try {
    const dbPassword =
      (await decryptField(tenant.database_password_encrypted)) ||
      tenant.database_password_encrypted;

    const isLocalHost =
      tenant.database_host === "localhost" ||
      tenant.database_host === "127.0.0.1";

    // Connect to the default 'postgres' database to issue DROP DATABASE
    const adminPool = new pg.Pool({
      host: tenant.database_host,
      port: tenant.database_port,
      database: "postgres",
      user: tenant.database_user,
      password: dbPassword,
      ssl: isLocalHost ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    try {
      // Terminate any remaining connections to the tenant database
      await adminPool.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tenant.database_name],
      );

      // Drop the database
      await adminPool.query(
        `DROP DATABASE IF EXISTS "${tenant.database_name}"`,
      );
      console.log(
        `[TenantProvisioning] Dropped database: ${tenant.database_name}`,
      );
    } finally {
      await adminPool.end();
    }
  } catch (err: any) {
    // Log but don't block the tenant row deletion — the DB may already be gone
    console.error(
      `[TenantProvisioning] Error dropping database ${tenant.database_name}: ${err.message}`,
    );
  }

  // 4. Hard-delete the tenant row (CASCADE will clean up related tables:
  //    tenant_api_keys, tenant_subscriptions, tenant_deployments, user_tenant_mappings, etc.)
  await managementPool.query(`DELETE FROM coheus_tenants WHERE id = $1`, [
    tenantId,
  ]);

  console.log(
    `[TenantProvisioning] Tenant ${tenantId} (${tenant.slug}) fully deleted`,
  );
}
