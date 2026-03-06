/**
 * Seed Local Development Database
 * 
 * This script creates the initial users and tenants for local development.
 * Run this once after setting up the Docker PostgreSQL container.
 * 
 * Creates:
 * - 1 Super Admin (Cohi internal)
 * - 1 Test Tenant "Acme Mortgage"
 * - 1 Tenant Admin for Acme
 * - 1 Regular User for Acme
 * 
 * Usage: npx tsx scripts/seed-local-dev.ts
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;

// Configuration - can be overridden via environment variables
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL || 'superadmin';
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || 'super123';
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME || 'Super Admin';

const TEST_TENANT_NAME = 'Acme Mortgage';
const TEST_TENANT_SLUG = 'acme-mortgage';

const TENANT_ADMIN_EMAIL = 'admin@acme.local';
const TENANT_ADMIN_PASSWORD = 'admin123';
const TENANT_ADMIN_NAME = 'Acme Admin';

const TEST_USER_EMAIL = 'user@acme.local';
const TEST_USER_PASSWORD = 'user123';
const TEST_USER_NAME = 'John Doe';

// Database configuration
const DB_CONFIG = {
  host: (process.env.DB_HOST || 'localhost').trim() === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

async function createDatabaseIfNotExists(pool: pg.Pool, dbName: string): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );
    
    if (result.rows.length === 0) {
      console.log(`📦 Creating database: ${dbName}`);
      await pool.query(`CREATE DATABASE "${dbName}"`);
    } else {
      console.log(`✓ Database exists: ${dbName}`);
    }
  } catch (error: any) {
    if (error.code === '42P04') {
      // Database already exists
      console.log(`✓ Database exists: ${dbName}`);
    } else {
      throw error;
    }
  }
}

async function initManagementSchema(pool: pg.Pool): Promise<void> {
  console.log('🔧 Initializing management database schema...');

  // Create coheus_tenants table (single source of truth for tenants)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coheus_tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      database_name TEXT UNIQUE NOT NULL,
      database_host TEXT NOT NULL DEFAULT '127.0.0.1',
      database_port INTEGER DEFAULT 5432,
      database_user TEXT NOT NULL DEFAULT 'postgres',
      database_password_encrypted TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted', 'provisioning')),
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Create coheus_users table (super admins and platform-level users)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coheus_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      encrypted_password TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'platform_admin', 'support')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_coheus_tenants_slug ON coheus_tenants(slug)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_coheus_tenants_status ON coheus_tenants(status)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_coheus_users_email ON coheus_users(email)`).catch(() => {});

  console.log('✓ Management schema initialized');
}

async function initTenantSchema(pool: pg.Pool): Promise<void> {
  console.log('🔧 Initializing tenant database schema...');

  // Create users table for tenant users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      encrypted_password TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('tenant_admin', 'user', 'viewer')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create profiles table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      avatar_url TEXT,
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `);

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`).catch(() => {});

  console.log('✓ Tenant schema initialized');
}

async function seedSuperAdmin(pool: pg.Pool): Promise<string> {
  console.log(`👤 Creating super admin: ${SUPER_ADMIN_EMAIL}`);
  
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  
  const result = await pool.query(`
    INSERT INTO coheus_users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, 'super_admin', true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      updated_at = NOW()
    RETURNING id
  `, [SUPER_ADMIN_EMAIL, passwordHash, SUPER_ADMIN_NAME]);
  
  console.log(`✓ Super admin created: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  return result.rows[0].id;
}

async function seedTestTenant(managementPool: pg.Pool): Promise<{ tenantId: string; dbName: string }> {
  console.log(`🏢 Creating test tenant: ${TEST_TENANT_NAME}`);
  
  const dbName = `tenant_${TEST_TENANT_SLUG.replace(/-/g, '_')}`;
  
  // For local dev, we use a placeholder for the encrypted password
  // In production, this would be properly encrypted
  const localDevPassword = 'local_dev_not_encrypted';
  
  const result = await managementPool.query(`
    INSERT INTO coheus_tenants (name, slug, database_name, database_host, database_user, database_password_encrypted, deployment_type, status)
    VALUES ($1, $2, $3, '127.0.0.1', 'postgres', $4, 'cloud', 'active')
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = NOW()
    RETURNING id
  `, [TEST_TENANT_NAME, TEST_TENANT_SLUG, dbName, localDevPassword]);
  
  console.log(`✓ Tenant created: ${TEST_TENANT_NAME} (${dbName})`);
  return { tenantId: result.rows[0].id, dbName };
}

async function seedTenantUsers(pool: pg.Pool): Promise<void> {
  console.log('👥 Creating tenant users...');
  
  // Create tenant admin
  const adminPasswordHash = await bcrypt.hash(TENANT_ADMIN_PASSWORD, 10);
  await pool.query(`
    INSERT INTO users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, 'tenant_admin', true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      role = 'tenant_admin',
      updated_at = NOW()
    RETURNING id
  `, [TENANT_ADMIN_EMAIL, adminPasswordHash, TENANT_ADMIN_NAME]);
  console.log(`✓ Tenant admin: ${TENANT_ADMIN_EMAIL} / ${TENANT_ADMIN_PASSWORD}`);
  
  // Create regular user
  const userPasswordHash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
  await pool.query(`
    INSERT INTO users (email, encrypted_password, full_name, role, is_active)
    VALUES ($1, $2, $3, 'user', true)
    ON CONFLICT (email) DO UPDATE SET
      encrypted_password = EXCLUDED.encrypted_password,
      full_name = EXCLUDED.full_name,
      role = 'user',
      updated_at = NOW()
    RETURNING id
  `, [TEST_USER_EMAIL, userPasswordHash, TEST_USER_NAME]);
  console.log(`✓ Regular user: ${TEST_USER_EMAIL} / ${TEST_USER_PASSWORD}`);
}

async function main() {
  console.log('🚀 Seeding Local Development Database\n');
  console.log('Database connection:', {
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
  });
  console.log('');

  // Connect to postgres database first to create other databases
  const postgresPool = new Pool({
    ...DB_CONFIG,
    database: 'postgres',
  });

  try {
    // Create management database
    await createDatabaseIfNotExists(postgresPool, 'coheus_management');
    
    // Create test tenant database
    const tenantDbName = `tenant_${TEST_TENANT_SLUG.replace(/-/g, '_')}`;
    await createDatabaseIfNotExists(postgresPool, tenantDbName);
    
    await postgresPool.end();

    // Initialize management database
    const managementPool = new Pool({
      ...DB_CONFIG,
      database: 'coheus_management',
    });

    await initManagementSchema(managementPool);
    await seedSuperAdmin(managementPool);
    const { dbName } = await seedTestTenant(managementPool);
    
    await managementPool.end();

    // Initialize tenant database
    const tenantPool = new Pool({
      ...DB_CONFIG,
      database: dbName,
    });

    await initTenantSchema(tenantPool);
    await seedTenantUsers(tenantPool);
    
    await tenantPool.end();

    console.log('\n✅ Seeding complete!\n');
    console.log('Test Accounts:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUPER ADMIN (Cohi Internal)');
    console.log(`  Email:    ${SUPER_ADMIN_EMAIL}`);
    console.log(`  Password: ${SUPER_ADMIN_PASSWORD}`);
    console.log(`  Role:     super_admin`);
    console.log('');
    console.log(`TENANT ADMIN (${TEST_TENANT_NAME})`);
    console.log(`  Email:    ${TENANT_ADMIN_EMAIL}`);
    console.log(`  Password: ${TENANT_ADMIN_PASSWORD}`);
    console.log(`  Role:     tenant_admin`);
    console.log('');
    console.log(`REGULAR USER (${TEST_TENANT_NAME})`);
    console.log(`  Email:    ${TEST_USER_EMAIL}`);
    console.log(`  Password: ${TEST_USER_PASSWORD}`);
    console.log(`  Role:     user`);
    console.log('═══════════════════════════════════════════════════════════');

  } catch (error: any) {
    console.error('❌ Seeding failed:', error.message);
    if (error.code) {
      console.error('   Error code:', error.code);
    }
    process.exit(1);
  }
}

main();
