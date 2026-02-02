/**
 * Tenant Schema Repair Script
 * 
 * Fixes schema inconsistencies in tenant databases before running migrations.
 * Run this if migrations are failing due to missing columns from older schemas.
 * 
 * Usage: 
 *   cd server
 *   npx tsx scripts/repair-tenant-schemas.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';

// Load env files
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

const connString = process.env.MANAGEMENT_DATABASE_URL || 
                   process.env.DATABASE_URL || 
                   'postgresql://postgres:postgres@localhost:5432/coheus_management';

const isLocalDb = connString.includes('localhost') || connString.includes('127.0.0.1');

console.log(`Using management database: ${connString.replace(/:[^:@]+@/, ':****@')}`);

const managementPool = new Pool({
  connectionString: connString,
  ssl: isLocalDb ? false : { rejectUnauthorized: false }
});

/**
 * Schema repairs to apply
 */
const schemaRepairs = [
  {
    name: 'Add file_hash to rag_documents',
    check: `
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'rag_documents' 
      AND column_name = 'file_hash'
    `,
    fix: `ALTER TABLE rag_documents ADD COLUMN file_hash TEXT`,
    table: 'rag_documents'
  },
  {
    name: 'Add chunk_count to rag_documents',
    check: `
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'rag_documents' 
      AND column_name = 'chunk_count'
    `,
    fix: `ALTER TABLE rag_documents ADD COLUMN chunk_count INTEGER DEFAULT 0`,
    table: 'rag_documents'
  },
  {
    name: 'Add token_count to rag_documents',
    check: `
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'rag_documents' 
      AND column_name = 'token_count'
    `,
    fix: `ALTER TABLE rag_documents ADD COLUMN token_count INTEGER DEFAULT 0`,
    table: 'rag_documents'
  }
];

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

async function tableExists(pool: pg.Pool, tableName: string): Promise<boolean> {
  const result = await pool.query(`
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
  return result.rows.length > 0;
}

async function repairTenantSchema(tenant: TenantConfig): Promise<void> {
  console.log(`\n📦 Repairing tenant: ${tenant.name} (${tenant.database_name})`);
  
  const pool = createTenantPool(tenant);
  
  try {
    await pool.query('SELECT 1');
    console.log(`  ✓ Connected`);

    let repairsApplied = 0;
    let repairsSkipped = 0;

    for (const repair of schemaRepairs) {
      // Check if the table exists first
      if (repair.table && !(await tableExists(pool, repair.table))) {
        console.log(`  ⏭ ${repair.name} - table doesn't exist yet (will be created by migration)`);
        repairsSkipped++;
        continue;
      }

      // Check if repair is needed
      const checkResult = await pool.query(repair.check);
      
      if (checkResult.rows.length === 0) {
        // Repair needed
        try {
          await pool.query(repair.fix);
          console.log(`  ✓ ${repair.name}`);
          repairsApplied++;
        } catch (error: any) {
          console.log(`  ✗ ${repair.name}: ${error.message}`);
        }
      } else {
        console.log(`  ⏭ ${repair.name} - already OK`);
        repairsSkipped++;
      }
    }

    console.log(`  📊 Applied: ${repairsApplied}, Skipped: ${repairsSkipped}`);

  } catch (error: any) {
    console.error(`  ❌ Error: ${error.message}`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  console.log('🔧 Tenant Schema Repair Tool\n');
  console.log('='.repeat(60));
  console.log('This tool fixes schema inconsistencies before running migrations.\n');
  
  try {
    await managementPool.query('SELECT 1');
    console.log('✓ Connected to management database\n');

    const tenants = await getAllTenants();
    console.log(`Found ${tenants.length} active tenant(s)`);

    for (const tenant of tenants) {
      await repairTenantSchema(tenant);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Schema repair complete!');
    console.log('\nNow run: npm run migrate:all');
    
  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await managementPool.end();
  }
}

main();
