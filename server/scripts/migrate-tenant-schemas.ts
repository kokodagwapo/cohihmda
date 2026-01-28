/**
 * Tenant Schema Migration Script
 * 
 * This script runs schema migrations on all tenant databases.
 * 
 * Usage: 
 *   npx tsx scripts/migrate-tenant-schemas.ts --db-url="postgresql://user:pass@localhost:5432/management"
 *   npx tsx scripts/migrate-tenant-schemas.ts --migration=drop-orphaned-columns
 *   npx tsx scripts/migrate-tenant-schemas.ts --report
 *   npx tsx scripts/migrate-tenant-schemas.ts --tenant=acme
 */

import pg from 'pg';
import dotenv from 'dotenv';

// Load env files from multiple locations
dotenv.config({ path: '../.env' });
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const { Pool } = pg;

interface TenantConfig {
  id: string;
  name: string;
  database_name: string;
  database_host: string;
  database_port: number;
  database_user: string;
  database_password: string;
}

// Parse command line args for database URL
const args = process.argv.slice(2);
const dbUrlArg = args.find(a => a.startsWith('--db-url='));
const connString = dbUrlArg?.split('=').slice(1).join('=') || 
                   process.env.MANAGEMENT_DATABASE_URL || 
                   process.env.DATABASE_URL || 
                   'postgresql://postgres:postgres@localhost:5432/coheus_management';

const isLocalDb = connString.includes('localhost') || connString.includes('127.0.0.1');

console.log(`Using database: ${connString.replace(/:[^:@]+@/, ':****@')}`);

const managementPool = new Pool({
  connectionString: connString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false }
});

/**
 * Migration: Drop orphaned columns that are not in the data dictionary
 */
async function migrationDropOrphanedColumns(pool: pg.Pool, tenantName: string): Promise<void> {
  const orphanedColumns = [
    'borrower_name',
    'status', 
    'fund_date',
    'pi_payment',
    'encompass_instance',
    'cycle_time_days'
  ];

  console.log(`  [${tenantName}] Dropping ${orphanedColumns.length} orphaned columns...`);

  for (const column of orphanedColumns) {
    try {
      await pool.query(`ALTER TABLE public.loans DROP COLUMN IF EXISTS ${column}`);
      console.log(`    ✓ Dropped column: ${column}`);
    } catch (error: any) {
      console.log(`    ✗ Failed to drop ${column}: ${error.message}`);
    }
  }
}

/**
 * Migration: Ensure funding_date column exists and has correct type
 */
async function migrationEnsureFundingDate(pool: pg.Pool, tenantName: string): Promise<void> {
  console.log(`  [${tenantName}] Ensuring funding_date column exists...`);
  
  try {
    // Check if column exists
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans' 
      AND column_name = 'funding_date'
    `);

    if (result.rows.length === 0) {
      await pool.query(`ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS funding_date TIMESTAMPTZ`);
      console.log(`    ✓ Added funding_date column`);
    } else {
      console.log(`    ✓ funding_date already exists (${result.rows[0].data_type})`);
    }
  } catch (error: any) {
    console.log(`    ✗ Error: ${error.message}`);
  }
}

/**
 * Get all active tenants from management database
 */
async function getAllTenants(): Promise<TenantConfig[]> {
  const result = await managementPool.query(`
    SELECT 
      id, name, database_name, database_host, database_port,
      database_user, database_password_encrypted as database_password
    FROM coheus_tenants 
    WHERE status = 'active'
    ORDER BY name
  `);

  return result.rows;
}

/**
 * Create a pool for a specific tenant database
 */
function createTenantPool(tenant: TenantConfig): pg.Pool {
  const isLocalHost = tenant.database_host === 'localhost' || 
                     tenant.database_host === '127.0.0.1';

  return new Pool({
    host: tenant.database_host,
    port: tenant.database_port,
    database: tenant.database_name,
    user: tenant.database_user,
    password: tenant.database_password,
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 10000,
  });
}

/**
 * Run all migrations on a tenant database
 */
async function runMigrationsOnTenant(tenant: TenantConfig, migrationName?: string): Promise<void> {
  console.log(`\n📦 Processing tenant: ${tenant.name} (${tenant.database_name})`);
  
  const pool = createTenantPool(tenant);
  
  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log(`  ✓ Connected to ${tenant.database_name}`);

    // Run specific migration or all migrations
    if (!migrationName || migrationName === 'drop-orphaned-columns') {
      await migrationDropOrphanedColumns(pool, tenant.name);
    }
    
    if (!migrationName || migrationName === 'ensure-funding-date') {
      await migrationEnsureFundingDate(pool, tenant.name);
    }

    console.log(`  ✅ Migrations complete for ${tenant.name}`);
  } catch (error: any) {
    console.error(`  ❌ Error for ${tenant.name}: ${error.message}`);
  } finally {
    await pool.end();
  }
}

/**
 * Report current schema for a tenant
 */
async function reportTenantSchema(tenant: TenantConfig): Promise<void> {
  console.log(`\n📊 Schema report for: ${tenant.name}`);
  
  const pool = createTenantPool(tenant);
  
  try {
    // Get all columns in loans table
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'loans'
      ORDER BY ordinal_position
    `);

    console.log(`  Total columns in loans table: ${result.rows.length}`);
    console.log(`  Columns:`);
    
    // Group by category
    const dateColumns = result.rows.filter(r => r.data_type.includes('timestamp') || r.data_type === 'date');
    const numericColumns = result.rows.filter(r => r.data_type === 'numeric' || r.data_type === 'integer');
    const textColumns = result.rows.filter(r => r.data_type === 'text' || r.data_type.includes('character'));
    const boolColumns = result.rows.filter(r => r.data_type === 'boolean');
    const otherColumns = result.rows.filter(r => 
      !['timestamp', 'date', 'numeric', 'integer', 'text', 'boolean'].some(t => r.data_type.includes(t)) &&
      !r.data_type.includes('character')
    );

    console.log(`    - Date/Time: ${dateColumns.length}`);
    console.log(`    - Numeric: ${numericColumns.length}`);
    console.log(`    - Text: ${textColumns.length}`);
    console.log(`    - Boolean: ${boolColumns.length}`);
    console.log(`    - Other (UUID, JSONB, vector): ${otherColumns.length}`);

  } catch (error: any) {
    console.error(`  ❌ Error: ${error.message}`);
  } finally {
    await pool.end();
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('🚀 Tenant Schema Migration Tool\n');
  console.log('=' .repeat(60));
  
  // Parse command line args
  const args = process.argv.slice(2);
  const migrationArg = args.find(a => a.startsWith('--migration='));
  const migrationName = migrationArg?.split('=')[1];
  const reportOnly = args.includes('--report');
  const tenantArg = args.find(a => a.startsWith('--tenant='));
  const specificTenant = tenantArg?.split('=')[1];

  if (migrationName) {
    console.log(`Running specific migration: ${migrationName}`);
  } else if (reportOnly) {
    console.log('Report mode: showing schema info only');
  } else {
    console.log('Running all migrations');
  }

  try {
    // Test management database connection
    await managementPool.query('SELECT 1');
    console.log('✓ Connected to management database\n');

    // Get all tenants
    const tenants = await getAllTenants();
    console.log(`Found ${tenants.length} active tenant(s)`);

    // Filter to specific tenant if requested
    const tenantsToProcess = specificTenant 
      ? tenants.filter(t => t.name.toLowerCase().includes(specificTenant.toLowerCase()) || t.id === specificTenant)
      : tenants;

    if (tenantsToProcess.length === 0) {
      console.log('No tenants found matching criteria');
      return;
    }

    // Process each tenant
    for (const tenant of tenantsToProcess) {
      if (reportOnly) {
        await reportTenantSchema(tenant);
      } else {
        await runMigrationsOnTenant(tenant, migrationName);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration complete!');
    
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await managementPool.end();
  }
}

main();
