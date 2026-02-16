#!/usr/bin/env node
/**
 * Migration CLI
 *
 * Command-line interface for running database migrations.
 *
 * Usage:
 *   npx tsx src/migrations/cli.ts status              # Show migration status
 *   npx tsx src/migrations/cli.ts up                  # Run all pending migrations
 *   npx tsx src/migrations/cli.ts up --dry-run       # Preview migrations without running
 *   npx tsx src/migrations/cli.ts up --target 003    # Run up to version 003
 *   npx tsx src/migrations/cli.ts tenant <slug>      # Run migrations for a specific tenant
 *   npx tsx src/migrations/cli.ts tenant --all       # Run migrations for all tenants
 *
 * Environment variables:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD - Database connection
 *   MANAGEMENT_DB_NAME - Management database name (default: coheus_management)
 */

import {
  MigrationRunner,
  createPool,
  getMigrationsDir,
  readMigrationFiles,
} from "./runner.js";
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../.env") });

const { Pool } = pg;

// Database configuration from environment
const isRemoteHost =
  process.env.DB_HOST &&
  process.env.DB_HOST !== "localhost" &&
  process.env.DB_HOST !== "127.0.0.1";

const DB_CONFIG = {
  host: (process.env.DB_HOST || "localhost").trim(),
  port: parseInt(process.env.DB_PORT || "5432"),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  // For RDS/Aurora: use SSL but skip certificate verification (VPC-internal)
  ssl: isRemoteHost ? { rejectUnauthorized: false } : false,
};

const MANAGEMENT_DB = process.env.MANAGEMENT_DB_NAME || "coheus_management";

interface TenantInfo {
  id: string;
  slug: string;
  database_name: string;
  database_host: string;
  database_port: number;
  status: string;
}

/**
 * Get list of active tenants from management database
 */
async function getActiveTenants(
  managementPool: pg.Pool
): Promise<TenantInfo[]> {
  const result = await managementPool.query(`
    SELECT id, slug, database_name, database_host, database_port, status
    FROM coheus_tenants
    WHERE status = 'active'
    ORDER BY slug
  `);
  return result.rows;
}

/**
 * Create database if it doesn't exist
 */
async function ensureDatabaseExists(dbName: string): Promise<void> {
  const postgresPool = new Pool({
    ...DB_CONFIG,
    database: "postgres",
  });

  try {
    const result = await postgresPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );

    if (result.rows.length === 0) {
      console.log(`📦 Creating database: ${dbName}`);
      await postgresPool.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await postgresPool.end();
  }
}

/**
 * Run migrations for management database
 */
async function runManagementMigrations(options: {
  dryRun?: boolean;
  targetVersion?: string;
  verbose?: boolean;
  force?: boolean;
}): Promise<boolean> {
  console.log("\n📊 Management Database Migrations");
  console.log("═".repeat(50));

  // Ensure database exists
  await ensureDatabaseExists(MANAGEMENT_DB);

  const pool = createPool({
    ...DB_CONFIG,
    database: MANAGEMENT_DB,
    ssl: DB_CONFIG.ssl,
  });

  try {
    const runner = new MigrationRunner(
      pool,
      "management",
      MANAGEMENT_DB,
      options.verbose
    );
    const migrationsDir = getMigrationsDir("management");

    const { applied, errors } = await runner.runPendingMigrations(
      migrationsDir,
      {
        dryRun: options.dryRun,
        targetVersion: options.targetVersion,
        force: options.force,
      }
    );

    if (errors.length > 0) {
      console.error(`\n❌ Migration failed with ${errors.length} error(s)`);
      return false;
    }

    if (applied.length === 0) {
      console.log("  ✓ Already up to date");
    } else {
      console.log(`\n✓ Applied ${applied.length} migration(s)`);
    }

    return true;
  } finally {
    await pool.end();
  }
}

/**
 * Run migrations for a specific tenant database
 */
async function runTenantMigrations(
  tenant: TenantInfo,
  options: {
    dryRun?: boolean;
    targetVersion?: string;
    verbose?: boolean;
    force?: boolean;
  }
): Promise<boolean> {
  console.log(`\n🏢 Tenant: ${tenant.slug} (${tenant.database_name})`);
  console.log("-".repeat(50));

  const pool = createPool({
    host: tenant.database_host || DB_CONFIG.host,
    port: tenant.database_port || DB_CONFIG.port,
    database: tenant.database_name,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    ssl: DB_CONFIG.ssl,
  });

  try {
    const runner = new MigrationRunner(
      pool,
      "tenant",
      tenant.database_name,
      options.verbose
    );
    const migrationsDir = getMigrationsDir("tenant");

    const { applied, errors } = await runner.runPendingMigrations(
      migrationsDir,
      {
        dryRun: options.dryRun,
        targetVersion: options.targetVersion,
        force: options.force,
      }
    );

    if (errors.length > 0) {
      console.error(`  ❌ Migration failed: ${errors[0].error}`);
      return false;
    }

    if (applied.length === 0) {
      console.log("  ✓ Already up to date");
    } else {
      console.log(`  ✓ Applied ${applied.length} migration(s)`);
    }

    return true;
  } finally {
    await pool.end();
  }
}

/**
 * Show migration status
 */
async function showStatus(
  dbType: "management" | "tenant",
  tenantSlug?: string
): Promise<void> {
  if (dbType === "management") {
    console.log("\n📊 Management Database Status");
    console.log("═".repeat(50));

    const pool = createPool({
      ...DB_CONFIG,
      database: MANAGEMENT_DB,
      ssl: DB_CONFIG.ssl,
    });

    try {
      const runner = new MigrationRunner(
        pool,
        "management",
        MANAGEMENT_DB,
        true
      );
      const migrationsDir = getMigrationsDir("management");
      const status = await runner.getStatus(migrationsDir);

      console.log(`\nDatabase: ${MANAGEMENT_DB}`);
      console.log(`Current version: ${status.current || "none"}`);
      console.log(`Applied: ${status.applied.length}`);
      console.log(`Pending: ${status.pending.length}`);

      if (status.applied.length > 0) {
        console.log("\nApplied migrations:");
        for (const m of status.applied) {
          console.log(
            `  ✓ ${m.version} - ${m.name} (${m.applied_at.toISOString()})`
          );
        }
      }

      if (status.pending.length > 0) {
        console.log("\nPending migrations:");
        for (const m of status.pending) {
          console.log(`  ○ ${m.version} - ${m.name}`);
        }
      }
    } finally {
      await pool.end();
    }
  } else {
    // Tenant status
    const managementPool = createPool({
      ...DB_CONFIG,
      database: MANAGEMENT_DB,
      ssl: DB_CONFIG.ssl,
    });

    try {
      const tenants = await getActiveTenants(managementPool);

      if (tenantSlug) {
        const tenant = tenants.find((t) => t.slug === tenantSlug);
        if (!tenant) {
          console.error(`Tenant not found: ${tenantSlug}`);
          return;
        }
        // Show status for specific tenant
        console.log(`\n🏢 Tenant: ${tenant.slug}`);
        // ... similar status display
      } else {
        console.log("\n🏢 Tenant Databases Status");
        console.log("═".repeat(50));
        console.log(`Found ${tenants.length} active tenant(s)`);

        for (const tenant of tenants) {
          console.log(`\n  ${tenant.slug}: ${tenant.database_name}`);
        }
      }
    } finally {
      await managementPool.end();
    }
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse flags
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const force =
    args.includes("--fix-checksums") ||
    args.includes("--force") ||
    args.includes("-f");
  const targetVersionIdx = args.indexOf("--target");
  const targetVersion =
    targetVersionIdx >= 0 ? args[targetVersionIdx + 1] : undefined;
  const allTenants = args.includes("--all");

  console.log("🔄 Coheus Database Migration Tool");
  console.log(`   Host: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
  console.log(`   SSL: ${DB_CONFIG.ssl ? "enabled" : "disabled"}`);

  if (dryRun) {
    console.log("   Mode: DRY RUN (no changes will be made)");
  }

  if (force) {
    console.log("   Mode: FIX CHECKSUMS (mismatches will be updated)");
  }

  try {
    switch (command) {
      case "status":
        await showStatus("management");
        break;

      case "up":
        // Run management migrations
        const mgmtSuccess = await runManagementMigrations({
          dryRun,
          targetVersion,
          verbose,
          force,
        });
        if (!mgmtSuccess) {
          process.exit(1);
        }
        break;

      case "tenant":
        // Run tenant migrations
        const tenantArg = args[1];

        if (!tenantArg && !allTenants) {
          console.error("Usage: migrate tenant <slug> or migrate tenant --all");
          process.exit(1);
        }

        // First ensure management DB is up to date
        const mgmtOk = await runManagementMigrations({
          dryRun,
          targetVersion,
          verbose,
          force,
        });
        if (!mgmtOk && !dryRun) {
          console.error(
            "Management migrations must succeed before tenant migrations"
          );
          process.exit(1);
        }

        // Get tenant list
        const managementPool = createPool({
          ...DB_CONFIG,
          database: MANAGEMENT_DB,
          ssl: DB_CONFIG.ssl,
        });

        try {
          const tenants = await getActiveTenants(managementPool);

          if (allTenants) {
            console.log(
              `\n🏢 Running migrations for ${tenants.length} tenant(s)`
            );
            let failed = 0;

            for (const tenant of tenants) {
              const success = await runTenantMigrations(tenant, {
                dryRun,
                targetVersion,
                verbose,
                force,
              });
              if (!success) failed++;
            }

            if (failed > 0) {
              console.error(`\n❌ ${failed} tenant(s) failed migration`);
              process.exit(1);
            }
          } else {
            const tenant = tenants.find((t) => t.slug === tenantArg);
            if (!tenant) {
              console.error(`Tenant not found: ${tenantArg}`);
              console.log(
                "Available tenants:",
                tenants.map((t) => t.slug).join(", ")
              );
              process.exit(1);
            }

            const success = await runTenantMigrations(tenant, {
              dryRun,
              targetVersion,
              verbose,
              force,
            });
            if (!success) process.exit(1);
          }
        } finally {
          await managementPool.end();
        }
        break;

      case "all":
        // Run all migrations (management + all tenants)
        console.log("\n🚀 Running all migrations...");

        // Management first
        const allMgmtOk = await runManagementMigrations({
          dryRun,
          targetVersion,
          verbose,
          force,
        });
        if (!allMgmtOk && !dryRun) {
          process.exit(1);
        }

        // Then all tenants
        const allMgmtPool = createPool({
          ...DB_CONFIG,
          database: MANAGEMENT_DB,
          ssl: DB_CONFIG.ssl,
        });

        try {
          const allTenantsList = await getActiveTenants(allMgmtPool);
          let allFailed = 0;

          for (const tenant of allTenantsList) {
            const success = await runTenantMigrations(tenant, {
              dryRun,
              targetVersion,
              verbose,
              force,
            });
            if (!success) allFailed++;
          }

          console.log("\n" + "═".repeat(50));
          console.log(`✓ Management database: OK`);
          console.log(
            `✓ Tenant databases: ${allTenantsList.length - allFailed}/${
              allTenantsList.length
            } OK`
          );

          if (allFailed > 0) {
            process.exit(1);
          }
        } finally {
          await allMgmtPool.end();
        }
        break;

      case "create":
        // Create a new migration file
        const migrationName = args[1];
        const migrationDbType = args.includes("--tenant")
          ? "tenant"
          : "management";

        if (!migrationName) {
          console.error("Usage: migrate create <name> [--tenant]");
          process.exit(1);
        }

        const migrationsDir = getMigrationsDir(migrationDbType);
        const existingMigrations = readMigrationFiles(migrationsDir);
        const nextVersion = String(existingMigrations.length + 1).padStart(
          3,
          "0"
        );
        const filename = `${nextVersion}_${migrationName
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase()}.sql`;
        const filepath = path.join(migrationsDir, filename);

        const template = `-- Migration: ${migrationName}
-- Created: ${new Date().toISOString()}
-- Database: ${migrationDbType}

-- Add your SQL statements here

`;

        const fs = await import("fs");
        fs.mkdirSync(migrationsDir, { recursive: true });
        fs.writeFileSync(filepath, template);

        console.log(`✓ Created: ${filepath}`);
        break;

      default:
        console.log(`
Usage: npx tsx src/migrations/cli.ts <command> [options]

Commands:
  status              Show migration status
  up                  Run pending management DB migrations
  tenant <slug>       Run migrations for a specific tenant
  tenant --all        Run migrations for all tenants
  all                 Run all migrations (management + all tenants)
  create <name>       Create a new migration file

Options:
  --dry-run          Preview without making changes
  --verbose, -v      Show detailed output
  --target <version> Run migrations up to specified version
  --fix-checksums    Update checksums for modified migrations (use with caution)
  --tenant           (for create) Create a tenant migration
`);
        process.exit(1);
    }

    console.log("\n✅ Migration complete");
  } catch (error: any) {
    console.error("\n❌ Migration error:", error.message);
    if (verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
