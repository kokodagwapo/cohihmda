/**
 * Initialize Local Development Database
 *
 * This script sets up a complete local development environment by:
 * 1. Creating the management database (coheus_management)
 * 2. Creating a test tenant database (tenant_acme_mortgage)
 * 3. Running all management database migrations
 * 4. Registering the test tenant in the management database
 * 5. Running all tenant database migrations
 * 6. Seeding test users (super admin, tenant admin, regular user)
 *
 * Usage:
 *   npx tsx scripts/init-local-database.ts
 *   npx tsx scripts/init-local-database.ts --skip-seed     # Skip seeding users
 *   npx tsx scripts/init-local-database.ts --reset         # Drop and recreate databases
 *   npx tsx scripts/init-local-database.ts --verbose       # Show detailed output
 *
 * Prerequisites:
 *   - PostgreSQL running (docker compose up -d postgres)
 *   - npm install completed in server folder
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  MigrationRunner,
  createPool,
  getMigrationsDir,
} from "../src/migrations/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const { Pool } = pg;

// =============================================================================
// Configuration
// =============================================================================

const DB_CONFIG = {
  host: (process.env.DB_HOST || "localhost").trim(),
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
};

const MANAGEMENT_DB = "coheus_management";
const TEST_TENANT_SLUG = "acme-mortgage";
const TEST_TENANT_DB = "tenant_acme_mortgage";
const TEST_TENANT_NAME = "Acme Mortgage";

// Test accounts
const TEST_ACCOUNTS = {
  superAdmin: {
    email: "superadmin",
    password: "super123",
    name: "Super Admin",
    role: "super_admin",
  },
  tenantAdmin: {
    email: "admin@acme.local",
    password: "admin123",
    name: "Acme Admin",
    role: "tenant_admin",
  },
  standardUser: {
    email: "user@acme.local",
    password: "user123",
    name: "John Doe",
    role: "user",
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message: string, color: keyof typeof colors = "reset"): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message: string): void {
  console.log(`${colors.green}✓ ${message}${colors.reset}`);
}

function warn(message: string): void {
  console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
}

function error(message: string): void {
  console.log(`${colors.red}✗ ${message}${colors.reset}`);
}

function step(num: number, message: string): void {
  console.log(`\n${colors.cyan}Step ${num}: ${message}${colors.reset}`);
}

// =============================================================================
// Database Operations
// =============================================================================

async function createDatabaseIfNotExists(
  adminPool: pg.Pool,
  dbName: string
): Promise<boolean> {
  const result = await adminPool.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [dbName]
  );

  if (result.rows.length === 0) {
    console.log(`  Creating database: ${dbName}`);
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    return true;
  } else {
    console.log(`  Database already exists: ${dbName}`);
    return false;
  }
}

async function dropDatabaseIfExists(
  adminPool: pg.Pool,
  dbName: string
): Promise<void> {
  // Terminate connections to the database
  await adminPool
    .query(
      `
    SELECT pg_terminate_backend(pg_stat_activity.pid)
    FROM pg_stat_activity
    WHERE pg_stat_activity.datname = $1
    AND pid <> pg_backend_pid()
  `,
      [dbName]
    )
    .catch(() => {});

  await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  console.log(`  Dropped database: ${dbName}`);
}

async function runMigrations(
  dbName: string,
  migrationType: "management" | "tenant",
  verbose: boolean
): Promise<void> {
  const pool = createPool({
    ...DB_CONFIG,
    database: dbName,
  });

  try {
    const runner = new MigrationRunner(pool, migrationType, dbName, verbose);
    const migrationsDir = getMigrationsDir(migrationType);

    const { applied, errors } = await runner.runPendingMigrations(
      migrationsDir,
      {
        verbose,
      }
    );

    if (errors.length > 0) {
      throw new Error(`Migration failed: ${errors[0].error}`);
    }

    if (applied.length === 0) {
      console.log("  Already up to date");
    } else {
      console.log(`  Applied ${applied.length} migration(s)`);
    }
  } finally {
    await pool.end();
  }
}

async function registerTenant(
  managementPool: pg.Pool,
  tenant: {
    name: string;
    slug: string;
    databaseName: string;
  }
): Promise<string> {
  const result = await managementPool.query(
    `
    INSERT INTO coheus_tenants (
      name, slug, database_name, database_host, database_port,
      database_user, database_password_encrypted, deployment_type, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'local_dev_not_encrypted', 'cloud', 'active')
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      database_host = EXCLUDED.database_host,
      database_port = EXCLUDED.database_port,
      updated_at = NOW()
    RETURNING id
  `,
    [
      tenant.name,
      tenant.slug,
      tenant.databaseName,
      DB_CONFIG.host,
      DB_CONFIG.port,
      DB_CONFIG.user,
    ]
  );

  return result.rows[0].id;
}

async function seedSuperAdmin(managementPool: pg.Pool): Promise<void> {
  const { email, password, name, role } = TEST_ACCOUNTS.superAdmin;
  const passwordHash = await bcrypt.hash(password, 10);

  await managementPool.query(
    `
    INSERT INTO coheus_users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      updated_at = NOW()
  `,
    [email, passwordHash, name, role]
  );

  console.log(`  Super admin: ${email}`);
}

async function seedTenantUsers(tenantPool: pg.Pool): Promise<void> {
  // Create users table if needed (migrations should have done this)
  await tenantPool
    .query(
      `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      encrypted_password TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
    )
    .catch(() => {});

  // Seed tenant admin
  const adminHash = await bcrypt.hash(TEST_ACCOUNTS.tenantAdmin.password, 10);
  await tenantPool.query(
    `
    INSERT INTO users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      updated_at = NOW()
  `,
    [
      TEST_ACCOUNTS.tenantAdmin.email,
      adminHash,
      TEST_ACCOUNTS.tenantAdmin.name,
      TEST_ACCOUNTS.tenantAdmin.role,
    ]
  );
  console.log(`  Tenant admin: ${TEST_ACCOUNTS.tenantAdmin.email}`);

  // Seed standard user
  const userHash = await bcrypt.hash(TEST_ACCOUNTS.standardUser.password, 10);
  await tenantPool.query(
    `
    INSERT INTO users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      updated_at = NOW()
  `,
    [
      TEST_ACCOUNTS.standardUser.email,
      userHash,
      TEST_ACCOUNTS.standardUser.name,
      TEST_ACCOUNTS.standardUser.role,
    ]
  );
  console.log(`  User: ${TEST_ACCOUNTS.standardUser.email}`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipSeed = args.includes("--skip-seed");
  const reset = args.includes("--reset");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    console.log(`
Coheus Local Database Initialization

USAGE:
    npx tsx scripts/init-local-database.ts [OPTIONS]

OPTIONS:
    --skip-seed    Skip seeding test users
    --reset        Drop and recreate all databases (WARNING: destroys data!)
    --verbose, -v  Show detailed migration output
    --help, -h     Show this help message

WHAT THIS SCRIPT DOES:
    1. Creates coheus_management database
    2. Creates test tenant database (tenant_acme_mortgage)
    3. Runs all management database migrations
    4. Registers the test tenant
    5. Runs all tenant database migrations
    6. Seeds test accounts:
       - Super Admin: superadmin / super123
       - Tenant Admin: admin@acme.local / admin123
       - User: user@acme.local / user123

PREREQUISITES:
    1. PostgreSQL running: docker compose up -d postgres
    2. Dependencies installed: npm install
`);
    return;
  }

  console.log("");
  log("============================================================", "blue");
  log("  Coheus Local Database Initialization", "blue");
  log("============================================================", "blue");
  console.log("");

  log("Database Configuration:", "cyan");
  console.log(`  Host:     ${DB_CONFIG.host}`);
  console.log(`  Port:     ${DB_CONFIG.port}`);
  console.log(`  User:     ${DB_CONFIG.user}`);
  console.log("");

  // Connect to postgres database for admin operations
  const adminPool = new Pool({
    ...DB_CONFIG,
    database: "postgres",
  });

  try {
    // Test connection
    await adminPool.query("SELECT 1");
    success("PostgreSQL connection established");
  } catch (err: any) {
    error(
      `Cannot connect to PostgreSQL at ${DB_CONFIG.host}:${DB_CONFIG.port}`
    );
    console.log("");
    warn("Make sure PostgreSQL is running:");
    console.log(
      "  docker compose -f docker/dev/docker-compose.dev.yml up -d postgres"
    );
    console.log("  # OR");
    console.log("  docker compose up -d postgres");
    process.exit(1);
  }

  try {
    // Reset if requested
    if (reset) {
      warn("RESETTING databases (all data will be lost)...");
      await dropDatabaseIfExists(adminPool, TEST_TENANT_DB);
      await dropDatabaseIfExists(adminPool, MANAGEMENT_DB);
      success("Databases dropped");
    }

    // Step 1: Create databases
    step(1, "Creating databases...");
    await createDatabaseIfNotExists(adminPool, MANAGEMENT_DB);
    await createDatabaseIfNotExists(adminPool, TEST_TENANT_DB);
    success("Databases ready");

    // Step 2: Run management migrations
    step(2, "Running management database migrations...");
    await runMigrations(MANAGEMENT_DB, "management", verbose);
    success("Management migrations complete");

    // Step 3: Register test tenant
    step(3, "Registering test tenant...");
    const managementPool = new Pool({
      ...DB_CONFIG,
      database: MANAGEMENT_DB,
    });

    try {
      await registerTenant(managementPool, {
        name: TEST_TENANT_NAME,
        slug: TEST_TENANT_SLUG,
        databaseName: TEST_TENANT_DB,
      });
      success(`Tenant registered: ${TEST_TENANT_NAME}`);
    } finally {
      await managementPool.end();
    }

    // Step 4: Run tenant migrations
    step(4, "Running tenant database migrations...");
    await runMigrations(TEST_TENANT_DB, "tenant", verbose);
    success("Tenant migrations complete");

    // Step 5: Seed test data
    if (!skipSeed) {
      step(5, "Seeding test data...");

      // Seed super admin in management DB
      const mgmtPool = new Pool({
        ...DB_CONFIG,
        database: MANAGEMENT_DB,
      });

      try {
        await seedSuperAdmin(mgmtPool);
      } finally {
        await mgmtPool.end();
      }

      // Seed tenant users
      const tenantPool = new Pool({
        ...DB_CONFIG,
        database: TEST_TENANT_DB,
      });

      try {
        await seedTenantUsers(tenantPool);
      } finally {
        await tenantPool.end();
      }

      success("Test data seeded");
    }

    // Done!
    console.log("");
    log(
      "============================================================",
      "green"
    );
    log("  Database initialization complete!", "green");
    log(
      "============================================================",
      "green"
    );
    console.log("");

    if (!skipSeed) {
      console.log("Test Accounts:");
      console.log(
        "------------------------------------------------------------"
      );
      console.log("SUPER ADMIN (Platform Level)");
      console.log(`  Email:    ${TEST_ACCOUNTS.superAdmin.email}`);
      console.log(`  Password: ${TEST_ACCOUNTS.superAdmin.password}`);
      console.log("");
      console.log(`TENANT ADMIN (${TEST_TENANT_NAME})`);
      console.log(`  Email:    ${TEST_ACCOUNTS.tenantAdmin.email}`);
      console.log(`  Password: ${TEST_ACCOUNTS.tenantAdmin.password}`);
      console.log("");
      console.log(`USER (${TEST_TENANT_NAME})`);
      console.log(`  Email:    ${TEST_ACCOUNTS.standardUser.email}`);
      console.log(`  Password: ${TEST_ACCOUNTS.standardUser.password}`);
      console.log(
        "------------------------------------------------------------"
      );
    }

    console.log("");
    console.log("Next steps:");
    console.log("  1. Start the backend:  npm run dev");
    console.log("  2. Start the frontend: cd .. && npm run dev");
    console.log("");
  } catch (err: any) {
    error(`Initialization failed: ${err.message}`);
    if (verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  } finally {
    await adminPool.end();
  }
}

main();
