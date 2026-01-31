/**
 * Database Migration Runner
 * 
 * Professional migration system for managing database schema changes.
 * Tracks applied migrations in a schema_migrations table.
 * 
 * Features:
 * - Versioned SQL migrations (001_*.sql, 002_*.sql, etc.)
 * - Separate migrations for management and tenant databases
 * - Transaction-wrapped migrations (all or nothing)
 * - Migration status tracking with checksums
 * - Dry-run mode for testing
 * - Rollback support (down migrations)
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Migration file naming convention: NNN_description.sql (e.g., 001_initial_schema.sql)
const MIGRATION_FILE_PATTERN = /^(\d{3})_(.+)\.sql$/;

export interface MigrationRecord {
  id: number;
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
  execution_time_ms: number;
}

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  filepath: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  success: boolean;
  version: string;
  name: string;
  executionTimeMs: number;
  error?: string;
}

export interface MigrationRunnerOptions {
  dryRun?: boolean;
  verbose?: boolean;
  targetVersion?: string;
  force?: boolean; // Skip checksum validation (use with caution)
}

/**
 * Calculate SHA256 checksum of migration content
 */
function calculateChecksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Read and parse migration files from a directory
 */
export function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => MIGRATION_FILE_PATTERN.test(f))
    .sort();

  return files.map(filename => {
    const match = filename.match(MIGRATION_FILE_PATTERN)!;
    const filepath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filepath, 'utf-8');
    
    return {
      version: match[1],
      name: match[2],
      filename,
      filepath,
      checksum: calculateChecksum(sql),
      sql,
    };
  });
}

/**
 * Migration Runner class
 */
export class MigrationRunner {
  private pool: pg.Pool;
  private dbType: 'management' | 'tenant';
  private dbName: string;
  private verbose: boolean;

  constructor(pool: pg.Pool, dbType: 'management' | 'tenant', dbName: string, verbose = false) {
    this.pool = pool;
    this.dbType = dbType;
    this.dbName = dbName;
    this.verbose = verbose;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(`[Migration:${this.dbName}] ${message}`);
    }
  }

  /**
   * Ensure schema_migrations table exists
   */
  async ensureMigrationTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(10) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        checksum VARCHAR(32) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL DEFAULT 0
      )
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
      ON schema_migrations(version)
    `).catch(() => {});
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const result = await this.pool.query(`
      SELECT id, version, name, checksum, applied_at, execution_time_ms
      FROM schema_migrations
      ORDER BY version ASC
    `);
    return result.rows;
  }

  /**
   * Check if a specific migration has been applied
   */
  async isMigrationApplied(version: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    );
    return result.rows.length > 0;
  }

  /**
   * Record a migration as applied
   */
  async recordMigration(migration: MigrationFile, executionTimeMs: number): Promise<void> {
    await this.pool.query(`
      INSERT INTO schema_migrations (version, name, checksum, execution_time_ms)
      VALUES ($1, $2, $3, $4)
    `, [migration.version, migration.name, migration.checksum, executionTimeMs]);
  }

  /**
   * Run a single migration within a transaction
   */
  async runMigration(migration: MigrationFile, dryRun = false): Promise<MigrationResult> {
    const startTime = Date.now();
    
    this.log(`Running migration ${migration.version}: ${migration.name}`);
    
    if (dryRun) {
      console.log(`[DRY RUN] Would run: ${migration.filename}`);
      console.log(migration.sql.substring(0, 500) + (migration.sql.length > 500 ? '...' : ''));
      return {
        success: true,
        version: migration.version,
        name: migration.name,
        executionTimeMs: 0,
      };
    }

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Run the migration SQL
      await client.query(migration.sql);
      
      // Record the migration
      const executionTimeMs = Date.now() - startTime;
      await client.query(`
        INSERT INTO schema_migrations (version, name, checksum, execution_time_ms)
        VALUES ($1, $2, $3, $4)
      `, [migration.version, migration.name, migration.checksum, executionTimeMs]);
      
      await client.query('COMMIT');
      
      return {
        success: true,
        version: migration.version,
        name: migration.name,
        executionTimeMs,
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      
      return {
        success: false,
        version: migration.version,
        name: migration.name,
        executionTimeMs: Date.now() - startTime,
        error: error.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Run all pending migrations
   */
  async runPendingMigrations(
    migrationsDir: string,
    options: MigrationRunnerOptions = {}
  ): Promise<{ applied: MigrationResult[]; pending: MigrationFile[]; errors: MigrationResult[] }> {
    const { dryRun = false, targetVersion, force = false } = options;
    
    // Ensure migration tracking table exists
    if (!dryRun) {
      await this.ensureMigrationTable();
    }
    
    // Read available migrations
    const allMigrations = readMigrationFiles(migrationsDir);
    
    if (allMigrations.length === 0) {
      this.log('No migration files found');
      return { applied: [], pending: [], errors: [] };
    }
    
    // Get already applied migrations
    const appliedMigrations = dryRun ? [] : await this.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    
    // Check for checksum mismatches (migration file changed after being applied)
    for (const applied of appliedMigrations) {
      const file = allMigrations.find(m => m.version === applied.version);
      if (file && file.checksum !== applied.checksum) {
        if (force) {
          console.warn(`⚠️  CHECKSUM MISMATCH (--force): Migration ${applied.version} (${applied.name}) - updating checksum`);
          console.warn(`   Old checksum: ${applied.checksum}`);
          console.warn(`   New checksum: ${file.checksum}`);
          // Update the checksum in the database to match current file
          await this.pool.query(
            'UPDATE schema_migrations SET checksum = $1 WHERE version = $2',
            [file.checksum, applied.version]
          );
        } else {
          console.error(`❌ CHECKSUM MISMATCH: Migration ${applied.version} (${applied.name}) has been modified after being applied!`);
          console.error(`   Applied checksum: ${applied.checksum}`);
          console.error(`   Current checksum: ${file.checksum}`);
          console.error(`   Use --fix-checksums to update and continue (use with caution)`);
          throw new Error(`Migration ${applied.version} has been modified. This is not allowed.`);
        }
      }
    }
    
    // Filter to pending migrations
    let pendingMigrations = allMigrations.filter(m => !appliedVersions.has(m.version));
    
    // If target version specified, only run up to that version
    if (targetVersion) {
      pendingMigrations = pendingMigrations.filter(m => m.version <= targetVersion);
    }
    
    if (pendingMigrations.length === 0) {
      this.log('All migrations are up to date');
      return { applied: [], pending: [], errors: [] };
    }
    
    // Run pending migrations in order
    const results: MigrationResult[] = [];
    const errors: MigrationResult[] = [];
    
    for (const migration of pendingMigrations) {
      const result = await this.runMigration(migration, dryRun);
      
      if (result.success) {
        results.push(result);
        console.log(`  ✓ ${migration.version}_${migration.name} (${result.executionTimeMs}ms)`);
      } else {
        errors.push(result);
        console.error(`  ✗ ${migration.version}_${migration.name}: ${result.error}`);
        // Stop on first error
        break;
      }
    }
    
    return { applied: results, pending: pendingMigrations, errors };
  }

  /**
   * Get migration status
   */
  async getStatus(migrationsDir: string): Promise<{
    applied: MigrationRecord[];
    pending: MigrationFile[];
    current: string | null;
  }> {
    await this.ensureMigrationTable();
    
    const allMigrations = readMigrationFiles(migrationsDir);
    const appliedMigrations = await this.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    
    const pendingMigrations = allMigrations.filter(m => !appliedVersions.has(m.version));
    const current = appliedMigrations.length > 0 
      ? appliedMigrations[appliedMigrations.length - 1].version 
      : null;
    
    return {
      applied: appliedMigrations,
      pending: pendingMigrations,
      current,
    };
  }
}

/**
 * Create a database connection pool
 */
export function createPool(config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

/**
 * Get migrations directory path
 */
export function getMigrationsDir(dbType: 'management' | 'tenant'): string {
  // Migrations are in server/migrations/management/ or server/migrations/tenant/
  return path.join(__dirname, '../../migrations', dbType);
}
