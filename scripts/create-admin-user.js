#!/usr/bin/env node
/**
 * Create Tenant Admin User
 * 
 * This script creates a tenant admin user using credentials from environment variables.
 * 
 * ⚠️  DEPRECATED: Use scripts/seed-default-users.js instead
 *     The new seed script supports all user roles and better security.
 * 
 * Usage: 
 *   cd server && npm run create-admin
 *   OR
 *   node scripts/create-admin-user.js
 * 
 * Environment Variables (REQUIRED):
 *   ADMIN_EMAIL    - Admin user email address
 *   ADMIN_PASSWORD - Admin user password (must be secure)
 * 
 * ⚠️  SECURITY WARNING:
 *   - Never use default or weak passwords in production
 *   - Always set ADMIN_EMAIL and ADMIN_PASSWORD via environment variables
 *   - For production deployments, use the comprehensive seed script:
 *     npm run seed:users:prod
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
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

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Validate required environment variables
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ ERROR: Missing required environment variables\n');
  console.error('   Required variables:');
  console.error('     ADMIN_EMAIL    - Email address for admin user');
  console.error('     ADMIN_PASSWORD - Secure password for admin user\n');
  console.error('   Set these in server/.env or export them before running this script.\n');
  console.error('   💡 TIP: Use the comprehensive seed script instead:');
  console.error('      npm run seed:users (from server directory)');
  console.error('      or');
  console.error('      node scripts/seed-default-users.js\n');
  process.exit(1);
}

async function createAdminUser() {
  try {
    console.log('🔐 Creating default admin user...\n');

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email, role FROM public.users WHERE email = $1',
      [ADMIN_EMAIL]
    );

    if (existingUser.rows.length > 0) {
      console.log(`⚠️  User ${ADMIN_EMAIL} already exists`);
      console.log(`   User ID: ${existingUser.rows[0].id}`);
      console.log(`   Role: ${existingUser.rows[0].role}`);
      console.log('\n✅ Admin user already exists. No action needed.');
      process.exit(0);
    }

    // Validate password strength
    if (ADMIN_PASSWORD.length < 8) {
      console.error('❌ ERROR: Password must be at least 8 characters long');
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Create user in public.users table
    const userResult = await pool.query(
      `INSERT INTO public.users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, role`,
      [ADMIN_EMAIL, passwordHash, 'Admin User', 'tenant_admin']
    );

    const userId = userResult.rows[0].id;

    // Create or get admin tenant
    let tenantResult = await pool.query(
      'SELECT id FROM public.tenants WHERE name = $1 LIMIT 1',
      ['Admin Tenant']
    );

    let tenantId;
    if (tenantResult.rows.length === 0) {
      const newTenant = await pool.query(
        'INSERT INTO public.tenants (name) VALUES ($1) RETURNING id',
        ['Admin Tenant']
      );
      tenantId = newTenant.rows[0].id;
    } else {
      tenantId = tenantResult.rows[0].id;
    }

    // Update user with tenant_id
    await pool.query(
      'UPDATE public.users SET tenant_id = $1 WHERE id = $2',
      [tenantId, userId]
    );

    // Create profile
    await pool.query(
      `INSERT INTO public.profiles (user_id, full_name, email, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET 
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         tenant_id = EXCLUDED.tenant_id`,
      [userId, 'Admin User', ADMIN_EMAIL, tenantId]
    );

    console.log('✅ Admin user created successfully!\n');
    console.log('📧 Email:', ADMIN_EMAIL);
    console.log('👤 User ID:', userId);
    console.log('👥 Role: tenant_admin');
    console.log('🏢 Tenant ID:', tenantId);
    console.log('\n🔒 Password was set from ADMIN_PASSWORD environment variable');
    console.log('\n💡 TIP: For creating multiple role users, use:');
    console.log('   npm run seed:users\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdminUser();

