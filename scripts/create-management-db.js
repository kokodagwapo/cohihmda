/**
 * Create Management Database Script
 * Node.js script to create the coheus_management database
 */

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '..', 'server', '.env');
  try {
    const envFile = readFileSync(envPath, 'utf-8');
    dotenv.config({ path: envPath });
  } catch (error) {
    // .env file might not exist, use defaults
    console.warn('WARNING: No .env file found, using defaults');
  }

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT || '5432');
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
const DB_NAME = process.env.MANAGEMENT_DB_NAME || 'coheus_management';

async function createManagementDatabase() {
  console.log('Creating management database:', DB_NAME);
  console.log(`   Host: ${DB_HOST}`);
  console.log(`   Port: ${DB_PORT}`);
  console.log(`   User: ${DB_USER}`);

  // Connect to postgres database to create new database
  const adminClient = new pg.Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
  });

  try {
    await adminClient.connect();
    console.log('SUCCESS: Connected to PostgreSQL');

    // Check if database already exists
    const checkResult = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [DB_NAME]
    );

    if (checkResult.rows.length > 0) {
      console.log(`WARNING: Database ${DB_NAME} already exists`);
      console.log('   Schema will be initialized on app start');
      await adminClient.end();
      return;
    }

    // Create database
    await adminClient.query(`CREATE DATABASE ${DB_NAME}`);
    console.log(`SUCCESS: Management database '${DB_NAME}' created successfully`);

    await adminClient.end();

    console.log('');
    console.log('Next steps:');
    console.log(`1. Set MANAGEMENT_DB_NAME=${DB_NAME} in your .env file`);
    console.log('2. Start your server - schema will initialize automatically');
    console.log('3. Or run: npm run init:management-schema');
  } catch (error) {
    console.error('ERROR: Failed to create management database:', error.message);
    if (error.code === '3D000') {
      console.error('   Database does not exist - this is expected for the first run');
    } else if (error.code === '28P01') {
      console.error('   Authentication failed - check DB_USER and DB_PASSWORD');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('   Connection refused - check DB_HOST and DB_PORT');
    }
    process.exit(1);
  }
}

createManagementDatabase();
