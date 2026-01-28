/**
 * Script to clear failed login attempts from the database
 * Usage: node scripts/clear-failed-logins.js [email]
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const { Pool } = pg;

// Security: Never use hardcoded credentials - always require environment variables
if (!process.env.DB_HOST || !process.env.DB_PASSWORD) {
  console.error('❌ Error: DB_HOST and DB_PASSWORD environment variables are required');
  console.error('   Please set these in server/.env or export them before running this script');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'Cohi',
  user: process.env.DB_USER || 'Cohiadmin',
  password: process.env.DB_PASSWORD, // Required - no fallback
  ssl: {
    rejectUnauthorized: false
  }
});

async function clearFailedLogins(email = null) {
  try {
    if (email) {
      const result = await pool.query(
        'DELETE FROM public.failed_login_attempts WHERE email = $1',
        [email]
      );
      console.log(`✅ Cleared ${result.rowCount} failed login attempts for ${email}`);
    } else {
      // Clear all failed logins older than 15 minutes
      const result = await pool.query(
        'DELETE FROM public.failed_login_attempts WHERE attempted_at < NOW() - INTERVAL \'15 minutes\''
      );
      console.log(`✅ Cleared ${result.rowCount} old failed login attempts`);
    }
    
    // Also clear all recent ones for admin@Cohi.com
    const adminResult = await pool.query(
      'DELETE FROM public.failed_login_attempts WHERE email = $1',
      ['admin@Cohi.com']
    );
    console.log(`✅ Cleared ${adminResult.rowCount} failed login attempts for admin@Cohi.com`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing failed logins:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const email = process.argv[2] || null;
clearFailedLogins(email);
