/**
 * Seed Super Admin User
 * 
 * Creates or updates a super admin user in the management database.
 * This script is designed to be run once per environment for initial setup.
 * 
 * Environment variables:
 *   SEED_SUPER_ADMIN_EMAIL    - Super admin email (required)
 *   SEED_SUPER_ADMIN_PASSWORD - Super admin password (required)
 *   SEED_SUPER_ADMIN_NAME     - Super admin display name (optional)
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD - Database connection
 *   MANAGEMENT_DB_NAME        - Management database name (default: coheus_management)
 * 
 * Usage:
 *   npx tsx scripts/seed-super-admin.ts
 *   
 *   # Or with environment variables:
 *   SEED_SUPER_ADMIN_EMAIL=admin@example.com \
 *   SEED_SUPER_ADMIN_PASSWORD=securepass123 \
 *   npx tsx scripts/seed-super-admin.ts
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;

// Configuration
const SUPER_ADMIN_EMAIL = process.env.SEED_SUPER_ADMIN_EMAIL;
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD;
const SUPER_ADMIN_NAME = process.env.SEED_SUPER_ADMIN_NAME || 'Super Admin';

const DB_CONFIG = {
  host: (process.env.DB_HOST || 'localhost').trim(),
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.MANAGEMENT_DB_NAME || 'coheus_management',
  ssl: process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1' 
    ? { rejectUnauthorized: false } 
    : false,
};

function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return { valid: errors.length === 0, errors };
}

function generateSecurePassword(): string {
  const length = 16;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  // Ensure at least one of each required character type
  password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
  password += '0123456789'[Math.floor(Math.random() * 10)];
  password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
  
  // Fill the rest
  for (let i = password.length; i < length; i++) {
    password += charset[Math.floor(Math.random() * charset.length)];
  }
  
  // Shuffle
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

async function main() {
  console.log('🔐 Super Admin Seeding Script\n');
  
  // Validate inputs
  if (!SUPER_ADMIN_EMAIL) {
    console.error('❌ ERROR: SEED_SUPER_ADMIN_EMAIL environment variable is required');
    console.log('\nUsage:');
    console.log('  SEED_SUPER_ADMIN_EMAIL=admin@example.com \\');
    console.log('  SEED_SUPER_ADMIN_PASSWORD=securepass123 \\');
    console.log('  npx tsx scripts/seed-super-admin.ts');
    process.exit(1);
  }
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(SUPER_ADMIN_EMAIL)) {
    console.error('❌ ERROR: Invalid email format');
    process.exit(1);
  }
  
  let password = SUPER_ADMIN_PASSWORD;
  let generatedPassword = false;
  
  // Generate password if not provided
  if (!password) {
    password = generateSecurePassword();
    generatedPassword = true;
    console.log('⚠️  No password provided, generating secure password...\n');
  } else {
    // Validate provided password
    const validation = validatePassword(password);
    if (!validation.valid) {
      console.error('❌ Password does not meet security requirements:');
      validation.errors.forEach(err => console.error(`   - ${err}`));
      console.log('\nPassword requirements:');
      console.log('  - At least 12 characters');
      console.log('  - At least one uppercase letter');
      console.log('  - At least one lowercase letter');
      console.log('  - At least one number');
      console.log('  - At least one special character (!@#$%^&*...)');
      process.exit(1);
    }
  }
  
  console.log('Database connection:', {
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    database: DB_CONFIG.database,
    ssl: DB_CONFIG.ssl ? 'enabled' : 'disabled',
  });
  console.log('');
  
  const pool = new Pool(DB_CONFIG);
  
  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✓ Database connected\n');
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id, email, role, is_active FROM coheus_users WHERE email = $1',
      [SUPER_ADMIN_EMAIL]
    );
    
    let userId: string;
    
    if (existingUser.rows.length > 0) {
      // Update existing user
      const result = await pool.query(`
        UPDATE coheus_users SET
          encrypted_password = $1,
          full_name = $2,
          role = 'super_admin',
          is_active = true,
          updated_at = NOW(),
          password_changed_at = NOW(),
          failed_login_attempts = 0,
          locked_until = NULL
        WHERE email = $3
        RETURNING id
      `, [passwordHash, SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL]);
      
      userId = result.rows[0].id;
      console.log('✓ Updated existing super admin user');
    } else {
      // Create new user
      const result = await pool.query(`
        INSERT INTO coheus_users (email, encrypted_password, full_name, role, is_active, password_changed_at)
        VALUES ($1, $2, $3, 'super_admin', true, NOW())
        RETURNING id
      `, [SUPER_ADMIN_EMAIL, passwordHash, SUPER_ADMIN_NAME]);
      
      userId = result.rows[0].id;
      console.log('✓ Created new super admin user');
    }
    
    console.log('');
    console.log('═'.repeat(60));
    console.log('SUPER ADMIN CREDENTIALS');
    console.log('═'.repeat(60));
    console.log(`  Email:    ${SUPER_ADMIN_EMAIL}`);
    console.log(`  Password: ${generatedPassword ? password : '(provided by you)'}`);
    console.log(`  Role:     super_admin`);
    console.log(`  User ID:  ${userId}`);
    console.log('═'.repeat(60));
    
    if (generatedPassword) {
      console.log('\n⚠️  IMPORTANT: Save this password securely! It will not be shown again.');
    }
    
    console.log('\n✅ Super admin seeding complete!');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\nCannot connect to database. Check:');
      console.error('  - Database host and port are correct');
      console.error('  - Database is running');
      console.error('  - Network/firewall allows connection');
    } else if (error.code === '3D000') {
      console.error('\nDatabase does not exist. Run migrations first:');
      console.error('  npx tsx src/migrations/cli.ts up');
    } else if (error.code === '42P01') {
      console.error('\nTable coheus_users does not exist. Run migrations first:');
      console.error('  npx tsx src/migrations/cli.ts up');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
