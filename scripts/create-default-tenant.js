#!/usr/bin/env node
/**
 * Create Default Tenant
 * 
 * This script creates a "Default" tenant record in the database.
 * 
 * Usage: 
 *   cd server && npm run create-default-tenant
 *   OR
 *   node scripts/create-default-tenant.js
 * 
 * The tenant will be created with the name "Default".
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from server/.env
const envPath = join(__dirname, '../server/.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
}

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'coheus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const DEFAULT_TENANT_NAME = 'Default';

async function createDefaultTenant() {
  try {
    console.log('🏢 Creating default tenant...\n');

    // Check if tenant already exists (case-insensitive)
    const existingTenant = await pool.query(
      'SELECT id, name FROM public.tenants WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [DEFAULT_TENANT_NAME]
    );

    if (existingTenant.rows.length > 0) {
      console.log(`⚠️  Tenant "${existingTenant.rows[0].name}" already exists`);
      console.log(`   Tenant ID: ${existingTenant.rows[0].id}`);
      console.log('\n✅ Default tenant already exists. No action needed.');
      process.exit(0);
    }

    // Create tenant
    const tenantResult = await pool.query(
      `INSERT INTO public.tenants (name, created_at, updated_at)
       VALUES ($1, NOW(), NOW())
       RETURNING id, name, created_at`,
      [DEFAULT_TENANT_NAME]
    );

    const tenant = tenantResult.rows[0];

    console.log('✅ Default tenant created successfully!\n');
    console.log('📝 Name:', tenant.name);
    console.log('🆔 Tenant ID:', tenant.id);
    console.log('📅 Created at:', tenant.created_at);
    console.log('\n✅ Tenant is ready to use.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating default tenant:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createDefaultTenant();

