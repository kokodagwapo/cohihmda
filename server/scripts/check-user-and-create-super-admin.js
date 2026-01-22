#!/usr/bin/env node
/**
 * Check Current User and Create Super Admin
 * 
 * This script:
 * 1. Lists all users in the database
 * 2. Creates a super_admin user if needed
 * 
 * Usage:
 *   cd server && npm run check-user
 * 
 * Environment Variables:
 *   ADMIN_EMAIL    - Email for super admin (default: admin@coheus.com)
 *   ADMIN_PASSWORD - Password for super admin (default: admin123)
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '../.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { Pool } = pg;

// Connect to default database (where users are stored)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'coheus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: false,
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@coheus.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function checkCurrentUser() {
  console.log('🔍 Checking users in database...\n');
  
  console.log('📝 To check who you\'re logged in as in the browser:');
  console.log('   1. Open browser DevTools (F12)');
  console.log('   2. Go to Application/Storage > Local Storage');
  console.log('   3. Look for "auth_token" key');
  console.log('   4. Copy the token value and decode at https://jwt.io\n');
  
  // List all users
  try {
    const usersResult = await pool.query(
      `SELECT id, email, role, full_name, is_active, tenant_id, created_at
       FROM public.users
       ORDER BY created_at DESC`
    );
    
    console.log(`📊 Found ${usersResult.rows.length} user(s) in database:\n`);
    
    if (usersResult.rows.length === 0) {
      console.log('   ⚠️  No users found in database\n');
    } else {
      usersResult.rows.forEach((user, index) => {
        console.log(`   ${index + 1}. ${user.email}`);
        console.log(`      Role: ${user.role}`);
        console.log(`      Name: ${user.full_name || 'N/A'}`);
        console.log(`      Active: ${user.is_active ? 'Yes' : 'No'}`);
        console.log(`      Tenant ID: ${user.tenant_id || 'N/A'}`);
        console.log(`      Created: ${user.created_at}`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('❌ Error querying users:', error.message);
    if (error.code === '42P01') {
      console.error('   Table "public.users" does not exist. Run database migrations first.');
    }
  }
}

async function createSuperAdmin() {
  console.log('🔐 Creating super admin user...\n');
  
  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email, role FROM public.users WHERE email = $1',
      [ADMIN_EMAIL]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      console.log(`⚠️  User ${ADMIN_EMAIL} already exists`);
      console.log(`   User ID: ${user.id}`);
      console.log(`   Current Role: ${user.role}`);
      
      // Update to super_admin if not already
      if (user.role !== 'super_admin') {
        await pool.query(
          'UPDATE public.users SET role = $1 WHERE id = $2',
          ['super_admin', user.id]
        );
        console.log(`   ✅ Updated role to super_admin\n`);
      } else {
        console.log(`   ✅ User is already super_admin\n`);
      }
      
      // Update password
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await pool.query(
        'UPDATE public.users SET encrypted_password = $1 WHERE id = $2',
        [passwordHash, user.id]
      );
      console.log(`   ✅ Password updated\n`);
      
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // Create super_admin user
    const userResult = await pool.query(
      `INSERT INTO public.users (email, encrypted_password, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, role`,
      [ADMIN_EMAIL, passwordHash, 'Super Admin', 'super_admin']
    );

    const userId = userResult.rows[0].id;

    console.log('✅ Super admin user created successfully!\n');
    console.log('📧 Email:', ADMIN_EMAIL);
    console.log('🔑 Password:', ADMIN_PASSWORD);
    console.log('👤 User ID:', userId);
    console.log('👥 Role: super_admin');
    console.log('\n💡 You can now log in with these credentials\n');
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    if (error.code === '42P01') {
      console.error('   Table "public.users" does not exist. Run database migrations first.');
    }
    throw error;
  }
}

async function main() {
  try {
    await checkCurrentUser();
    await createSuperAdmin();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
