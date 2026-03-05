#!/usr/bin/env node
/**
 * Seed Default Users for All Roles
 * 
 * This script creates default users for all roles (tenant_admin, user, viewer)
 * using secure credentials from environment variables.
 * 
 * Usage:
 *   npm run seed:users (from server directory)
 *   OR
 *   node scripts/seed-default-users.js (from project root)
 * 
 * Environment Variables:
 *   ADMIN_EMAIL    - Admin user email (default: generates random)
 *   ADMIN_PASSWORD - Admin user password (required in production)
 *   USER_EMAIL     - Standard user email (default: generates random)
 *   USER_PASSWORD  - Standard user password (optional)
 *   VIEWER_EMAIL   - Viewer user email (default: generates random)
 *   VIEWER_PASSWORD- Viewer user password (optional)
 * 
 * Security:
 *   - Production (NODE_ENV=production): Requires all passwords via env vars
 *   - Development: Generates secure random passwords if not provided
 *   - Never logs plain-text passwords in production
 *   - Idempotent: Safe to run multiple times (skips existing users)
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

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

const isProduction = process.env.NODE_ENV === 'production';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'coheus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

/**
 * Generate a secure random password
 * @param {number} length - Password length (default: 24)
 * @returns {string} Secure random password
 */
function generateSecurePassword(length = 24) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  
  return password;
}

/**
 * User configuration for seeding
 */
const userConfigs = [
  {
    role: 'tenant_admin',
    email: process.env.ADMIN_EMAIL || `admin-${Date.now()}@coheus.local`,
    password: process.env.ADMIN_PASSWORD,
    fullName: 'Admin User',
    tenantName: 'Admin Tenant',
    required: true, // Tenant admin is required
  },
  {
    role: 'user',
    email: process.env.USER_EMAIL || `user-${Date.now()}@coheus.local`,
    password: process.env.USER_PASSWORD,
    fullName: 'Standard User',
    tenantName: 'User Tenant',
    required: false,
  },
  {
    role: 'viewer',
    email: process.env.VIEWER_EMAIL || `viewer-${Date.now()}@coheus.local`,
    password: process.env.VIEWER_PASSWORD,
    fullName: 'Viewer User',
    tenantName: 'Viewer Tenant',
    required: false,
  },
];

/**
 * Create a user with associated tenant and profile
 */
async function createUser(config, generatedPassword) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { role, email, password, fullName, tenantName } = config;
    const finalPassword = password || generatedPassword;
    
    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id, email, role FROM public.users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      console.log(`⚠️  User already exists: ${email} (${role})`);
      console.log(`   User ID: ${existingUser.rows[0].id}`);
      await client.query('ROLLBACK');
      return { exists: true, email, role };
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(finalPassword, 10);
    
    // Create user
    const userResult = await client.query(
      `INSERT INTO public.users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, email, role`,
      [email, passwordHash, fullName, role]
    );
    
    const userId = userResult.rows[0].id;
    
    // Create or get tenant
    let tenantResult = await client.query(
      'SELECT id FROM public.tenants WHERE name = $1 LIMIT 1',
      [tenantName]
    );
    
    let tenantId;
    if (tenantResult.rows.length === 0) {
      const newTenant = await client.query(
        'INSERT INTO public.tenants (name) VALUES ($1) RETURNING id',
        [tenantName]
      );
      tenantId = newTenant.rows[0].id;
    } else {
      tenantId = tenantResult.rows[0].id;
    }
    
    // Update user with tenant_id
    await client.query(
      'UPDATE public.users SET tenant_id = $1 WHERE id = $2',
      [tenantId, userId]
    );
    
    // Create profile
    await client.query(
      `INSERT INTO public.profiles (user_id, full_name, email, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET 
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         tenant_id = EXCLUDED.tenant_id`,
      [userId, fullName, email, tenantId]
    );
    
    await client.query('COMMIT');
    
    return {
      created: true,
      userId,
      tenantId,
      email,
      role,
      password: finalPassword,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Save credentials to secure file in development
 */
function saveCredentialsToFile(createdUsers) {
  if (isProduction) return; // Never save to file in production
  
  const credentialsDir = join(__dirname, '../.credentials');
  const credentialsFile = join(credentialsDir, `users-${Date.now()}.txt`);
  
  try {
    if (!existsSync(credentialsDir)) {
      mkdirSync(credentialsDir, { recursive: true });
    }
    
    let content = '# Default User Credentials (DEVELOPMENT ONLY)\n';
    content += '# IMPORTANT: Change these passwords before deploying to production!\n';
    content += `# Generated: ${new Date().toISOString()}\n\n`;
    
    createdUsers.forEach(user => {
      if (user.created && user.password) {
        content += `${user.role.toUpperCase()} USER:\n`;
        content += `  Email: ${user.email}\n`;
        content += `  Password: ${user.password}\n`;
        content += `  User ID: ${user.userId}\n`;
        content += `  Tenant ID: ${user.tenantId}\n\n`;
      }
    });
    
    writeFileSync(credentialsFile, content, { mode: 0o600 }); // Read/write for owner only
    console.log(`\n📝 Credentials saved to: ${credentialsFile}`);
    console.log(`   (File is restricted to owner read/write only)`);
  } catch (error) {
    console.error('⚠️  Could not save credentials file:', error.message);
  }
}

/**
 * Main seeding function
 */
async function seedUsers() {
  console.log('🌱 Seeding default users...\n');
  console.log(`Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}\n`);
  
  // Validate production requirements
  if (isProduction) {
    const missingPasswords = userConfigs
      .filter(c => c.required && !c.password)
      .map(c => c.role);
    
    if (missingPasswords.length > 0) {
      console.error('❌ PRODUCTION ERROR: Required passwords not provided via environment variables');
      console.error(`   Missing passwords for roles: ${missingPasswords.join(', ')}`);
      console.error('\n   Set these environment variables:');
      missingPasswords.forEach(role => {
        console.error(`     ${role.toUpperCase()}_PASSWORD=<secure-password>`);
      });
      process.exit(1);
    }
  }
  
  const createdUsers = [];
  const warnings = [];
  
  for (const config of userConfigs) {
    try {
      let generatedPassword = null;
      
      // Generate password if not provided
      if (!config.password) {
        if (isProduction && config.required) {
          throw new Error(`Password required for ${config.role} in production`);
        }
        generatedPassword = generateSecurePassword();
        warnings.push(`Generated random password for ${config.role} user`);
      }
      
      const result = await createUser(config, generatedPassword);
      createdUsers.push(result);
      
      if (result.created) {
        console.log(`✅ Created ${result.role} user: ${result.email}`);
        if (!isProduction && result.password) {
          console.log(`   Password: ${result.password}`);
        }
        console.log(`   User ID: ${result.userId}`);
        console.log(`   Tenant ID: ${result.tenantId}\n`);
      }
    } catch (error) {
      console.error(`❌ Error creating ${config.role} user:`, error.message);
      if (config.required) {
        throw error; // Fail if required user cannot be created
      }
    }
  }
  
  // Display warnings
  if (warnings.length > 0 && !isProduction) {
    console.log('\n⚠️  WARNINGS:\n');
    warnings.forEach(warning => console.log(`   - ${warning}`));
  }
  
  // Save credentials to file in development
  const newUsers = createdUsers.filter(u => u.created);
  if (newUsers.length > 0 && !isProduction) {
    saveCredentialsToFile(newUsers);
  }
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Users created: ${createdUsers.filter(u => u.created).length}`);
  console.log(`Users already existed: ${createdUsers.filter(u => u.exists).length}`);
  
  if (isProduction) {
    console.log('\n🔒 PRODUCTION MODE: Credentials not displayed or saved to file');
    console.log('   Passwords were set from environment variables');
  } else {
    console.log('\n⚠️  DEVELOPMENT MODE: Remember to:');
    console.log('   1. Change default passwords before production deployment');
    console.log('   2. Set environment variables for production credentials');
    console.log('   3. Never commit the .credentials/ directory to version control');
  }
  
  console.log('\n✅ User seeding complete!\n');
}

// Run the seeding process
seedUsers()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error during user seeding:', error);
    pool.end();
    process.exit(1);
  });

