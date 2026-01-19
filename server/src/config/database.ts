import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env in server directory
dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;

// Lazy initialization - pool is created when first accessed
let poolInstance: pg.Pool | null = null;

// Function to reset the pool (close existing and create new)
export function resetPool(): void {
  if (poolInstance) {
    console.log('🔄 Resetting database connection pool...');
    poolInstance.end().catch(err => {
      console.error('Error closing old pool:', err);
    });
    poolInstance = null;
  }
}

function getPool(): pg.Pool {
  // Force reload of .env to ensure we have latest values
  dotenv.config({ path: join(__dirname, '../.env') });
  
  if (!poolInstance) {
    const envTrim = (v: string | undefined) => (typeof v === 'string' ? v.trim() : v);

    // Fix IPv6/IPv4 issue: Use 127.0.0.1 instead of localhost to avoid IPv6 resolution
    // On Windows, localhost can resolve to ::1 (IPv6) which may not be available
    // This only affects localhost - AWS RDS hostnames are used as-is
    const rawHost = envTrim(process.env.DB_HOST) || 'localhost';
    const dbHost = (rawHost === 'localhost' || rawHost === '127.0.0.1') ? '127.0.0.1' : rawHost;
    
    // Log database connection details (without password) for debugging
    const dbConfig = {
      host: dbHost,
      port: parseInt(envTrim(process.env.DB_PORT) || '5432'),
      database: envTrim(process.env.DB_NAME) || 'coheus',
      user: envTrim(process.env.DB_USER) || 'postgres',
      password: envTrim(process.env.DB_PASSWORD) || 'postgres',
    };
    
    // Validate required database configuration
    if (!dbConfig.password || dbConfig.password === 'postgres') {
      console.warn('⚠️  Database password not set or using default - connection may fail');
    }
    if (!dbConfig.host || dbConfig.host === 'localhost') {
      console.warn('⚠️  Database host is localhost - ensure database is running locally');
    }
    
    console.log('🔌 Database connection config:', {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password ? '***' : 'NOT SET',
      hasPassword: !!dbConfig.password,
      ssl: 'auto',
    });

    // SSL handling:
    // - AWS RDS commonly requires SSL ("no pg_hba.conf entry ... no encryption" when ssl is off)
    // - Elastic Beanstalk may not set NODE_ENV=production by default
    // - Default: enable SSL for any non-local host, but allow override via DB_SSL
    const dbSslEnv = (process.env.DB_SSL || '').trim().toLowerCase();
    const isLocalHost = dbHost === '127.0.0.1' || dbHost === 'localhost';
    const sslEnabled =
      dbSslEnv === 'true' || dbSslEnv === '1' || dbSslEnv === 'on'
        ? true
        : dbSslEnv === 'false' || dbSslEnv === '0' || dbSslEnv === 'off'
          ? false
          : !isLocalHost;

    console.log('🔐 Database SSL:', {
      enabled: sslEnabled,
      reason:
        dbSslEnv
          ? `DB_SSL=${process.env.DB_SSL}`
          : isLocalHost
            ? 'local host'
            : 'non-local host (default)',
    });
    
    poolInstance = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 50, // Increased from 20 to handle large imports
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000, // Increased to 30 seconds
      query_timeout: 60000, // Increased to 60 seconds for large imports
      // Add retry logic
      allowExitOnIdle: false,
    });

    // Handle connection errors
    poolInstance.on('error', (err: any) => {
      console.error('Unexpected database pool error:', {
        message: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        address: err.address,
        port: err.port,
      });
      // Don't crash the app, just log the error
      // The pool will attempt to reconnect on next query
    });

    // Handle connect events - set timezone to UTC for each connection
    poolInstance.on('connect', async (client) => {
      console.log('✅ New database connection established');
      // Set timezone to UTC for this connection to ensure consistent timestamp handling
      try {
        await client.query('SET timezone = UTC');
        console.log('✅ Database connection timezone set to UTC');
      } catch (err) {
        console.warn('⚠️ Failed to set timezone to UTC:', err);
      }
    });
  }
  return poolInstance;
}

// Helper function to retry database queries
export async function retryQuery<T>(
  queryFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error: any) {
      lastError = error;
      const isConnectionError = 
        error?.message?.includes('timeout') ||
        error?.message?.includes('ECONNREFUSED') ||
        error?.message?.includes('connection') ||
        error?.code === 'ETIMEDOUT' ||
        error?.code === 'ECONNREFUSED';
      
      if (isConnectionError && attempt < maxRetries) {
        console.warn(`⚠️ Database connection attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        // Reset pool on connection errors to force reconnection
        if (attempt === 1) {
          resetPool();
          console.log('🔄 Reset database pool due to connection error');
        }
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
  
  throw lastError || new Error('Database query failed after retries');
}

/**
 * Check if an error is a database connection error
 * @param error - The error to check
 * @returns true if the error is a connection error
 */
export function isDatabaseConnectionError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code;
  
  return (
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('connect econnrefused') ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'ECONNRESET'
  );
}

/**
 * Handle database errors and return appropriate HTTP response
 * @param error - The database error
 * @param res - Express response object
 * @param defaultMessage - Default error message if not a connection error
 * @returns true if response was sent, false otherwise
 */
export function handleDatabaseError(error: any, res: any, defaultMessage: string = 'Internal server error'): boolean {
  if (isDatabaseConnectionError(error)) {
    console.error('Database connection error:', error);
    res.status(503).json({
      error: 'Service temporarily unavailable. Database connection failed.',
      retry: true,
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
    return true;
  }
  
  // Check for missing table/database errors
  if (error?.message?.includes('does not exist') || error?.code === '42P01') {
    console.error('Database table missing:', error);
    res.status(503).json({
      error: 'Database not initialized. Please restart the server to run migrations.',
      retry: false
    });
    return true;
  }
  
  return false;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return getPool()[prop as keyof pg.Pool];
  }
}) as pg.Pool;

export async function initDatabase(): Promise<void> {
  try {
    // Set timezone to UTC for the initial connection
    await pool.query('SET timezone = UTC');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected (timezone: UTC)');
    
    // Run migrations (don't block server startup on migration warnings)
    try {
      await runMigrations();
    } catch (migrationError) {
      console.warn('⚠️ Migration warnings (server will continue):', migrationError);
      // Don't throw - allow server to start even with migration warnings
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

async function runMigrations() {
  try {
    // Create auth schema if it doesn't exist
    await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
    
    // Create users table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        encrypted_password TEXT NOT NULL,
        email_confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create tenants table FIRST (no dependencies)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create public.users table BEFORE profiles (profiles references users)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        encrypted_password TEXT NOT NULL,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor')),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    // Add missing columns if table already exists (migration)
    await pool.query(`
      DO $$
      BEGIN
        -- Add role column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'role'
        ) THEN
          ALTER TABLE public.users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
          ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor'));
        END IF;
        
        -- Update existing role constraint if it exists to allow all roles
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND constraint_name = 'users_role_check'
        ) THEN
          ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
          ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor'));
        END IF;
        
        -- Add tenant_id column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'tenant_id'
        ) THEN
          ALTER TABLE public.users ADD COLUMN tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;
        END IF;
        
        -- Add is_active column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'is_active'
        ) THEN
          ALTER TABLE public.users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
        END IF;
        
        -- Add email_confirmed_at column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'email_confirmed_at'
        ) THEN
          ALTER TABLE public.users ADD COLUMN email_confirmed_at TIMESTAMPTZ;
        END IF;
        
        -- Add last_login_at column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'last_login_at'
        ) THEN
          ALTER TABLE public.users ADD COLUMN last_login_at TIMESTAMPTZ;
        END IF;
        
        -- Add full_name column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'full_name'
        ) THEN
          ALTER TABLE public.users ADD COLUMN full_name TEXT;
        END IF;
      END $$;
    `).catch((err) => {
      console.warn('⚠️  Error adding columns to users table:', err.message);
    });
    
    // Create indexes for users table
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email)
    `).catch(() => {});
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id)
    `).catch(() => {});
    
    // Migrate password_hash to encrypted_password if needed
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'password_hash'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND column_name = 'encrypted_password'
        ) THEN
          ALTER TABLE public.users RENAME COLUMN password_hash TO encrypted_password;
        END IF;
      END $$;
    `).catch(() => {});
    
    // Update role constraint to allow all valid roles
    await pool.query(`
      DO $$
      BEGIN
        -- Drop existing constraint if it exists
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND constraint_name = 'users_role_check'
        ) THEN
          ALTER TABLE public.users DROP CONSTRAINT users_role_check;
        END IF;
        
        -- Add updated constraint with all valid roles
        ALTER TABLE public.users ADD CONSTRAINT users_role_check 
          CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor'));
      END $$;
    `).catch((err) => {
      console.warn('⚠️  Error updating role constraint:', err.message);
    });
    
    // Create profiles table AFTER users exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
        full_name TEXT,
        avatar_url TEXT,
        tenant_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create default tenant if it doesn't exist
    try {
      const defaultTenantResult = await pool.query(`
        INSERT INTO public.tenants (name, created_at, updated_at)
        SELECT 'Default', NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM public.tenants WHERE LOWER(name) = LOWER('Default')
        )
        RETURNING id, name
      `);
      if (defaultTenantResult.rows.length > 0) {
        console.log('✅ Default tenant created:', defaultTenantResult.rows[0].name);
      }
    } catch (err: any) {
      console.warn('⚠️  Error creating default tenant:', err.message);
    }
    
    // Create contacts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        employer TEXT,
        employment_status TEXT,
        monthly_income NUMERIC,
        loan_amount_requested NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create call_sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.call_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        duration_seconds INTEGER,
        status TEXT DEFAULT 'in_progress',
        sentiment_score NUMERIC,
        summary TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
        call_session_id UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        document_type TEXT DEFAULT 'other',
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create LOS connections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.los_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID,
        los_type TEXT NOT NULL,
        name TEXT NOT NULL,
        connection_method TEXT NOT NULL,
        api_base_url TEXT,
        api_client_id TEXT,
        api_client_secret TEXT,
        api_key TEXT,
        api_access_token TEXT,
        api_refresh_token TEXT,
        api_token_expires_at TIMESTAMPTZ,
        api_environment TEXT DEFAULT 'sandbox',
        oauth_authorization_url TEXT,
        oauth_token_url TEXT,
        oauth_scopes TEXT,
        db_host TEXT,
        db_port INTEGER,
        db_name TEXT,
        db_user TEXT,
        db_password TEXT,
        csv_upload_schedule TEXT,
        csv_last_uploaded_at TIMESTAMPTZ,
        csv_upload_path TEXT,
        csv_field_mapping JSONB,
        sync_enabled BOOLEAN DEFAULT true,
        sync_frequency TEXT DEFAULT 'hourly',
        last_synced_at TIMESTAMPTZ,
        last_sync_status TEXT,
        last_sync_error TEXT,
        webhook_url TEXT,
        webhook_secret TEXT,
        webhook_enabled BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID
      )
    `);
    
    // Create LOS sync logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.los_sync_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        los_connection_id UUID,
        tenant_id UUID,
        sync_type TEXT,
        status TEXT NOT NULL,
        records_synced INTEGER DEFAULT 0,
        records_failed INTEGER DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        metadata JSONB
      )
    `);
    
    // Create loans table (single source of truth for LOS-synced data)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        loan_id TEXT NOT NULL,
        borrower_name TEXT,
        loan_amount NUMERIC,
        loan_type TEXT,
        status TEXT,
        application_date TIMESTAMPTZ,
        closing_date TIMESTAMPTZ,
        interest_rate NUMERIC,
        loan_officer_id UUID,
        branch TEXT,
        loan_purpose TEXT,
        cycle_time_days INTEGER,
        credit_pull_date TIMESTAMPTZ,
        lock_date TIMESTAMPTZ,
        fund_date TIMESTAMPTZ,
        raw_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID,
        UNIQUE(tenant_id, loan_id)
      )
    `);
    
    // Create vendor connections table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.vendor_connections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        vendor_name TEXT NOT NULL,
        vendor_category TEXT NOT NULL CHECK (vendor_category IN ('accounting', 'capital_markets', 'servicing')),
        connection_type TEXT NOT NULL CHECK (connection_type IN ('vendor_initiated', 'lender_initiated')),
        vendor_api_key TEXT,
        vendor_api_endpoint TEXT,
        vendor_credentials TEXT,
        vendor_webhook_url TEXT,
        vendor_webhook_secret TEXT,
        data_mapping JSONB,
        connection_status TEXT DEFAULT 'pending' CHECK (connection_status IN ('pending', 'active', 'inactive', 'error')),
        sync_enabled BOOLEAN DEFAULT true,
        sync_frequency TEXT DEFAULT 'hourly' CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly')),
        last_synced_at TIMESTAMPTZ,
        last_sync_status TEXT,
        last_sync_error TEXT,
        metadata JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_by UUID
      )
    `);
    
    // Create vendor sync logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.vendor_sync_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vendor_connection_id UUID REFERENCES public.vendor_connections(id) ON DELETE CASCADE,
        tenant_id UUID,
        sync_type TEXT,
        status TEXT NOT NULL,
        records_synced INTEGER DEFAULT 0,
        records_failed INTEGER DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        metadata JSONB
      )
    `);
    
    // Create tenant field mappings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.tenant_field_mappings (
        tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
        field_mappings JSONB DEFAULT '{}',
        custom_display_names JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create subscription plans table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.subscription_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        price_monthly DECIMAL(10,2) NOT NULL,
        price_yearly DECIMAL(10,2) NOT NULL,
        features JSONB NOT NULL DEFAULT '{}',
        deployment_options TEXT[] NOT NULL DEFAULT ARRAY['cloud'],
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create tenant subscriptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'paused')),
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        deployment_type TEXT NOT NULL CHECK (deployment_type IN ('on_premise', 'hybrid', 'per_lender_aws')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id)
      )
    `);
    
    // Create deployment instances table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.deployment_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        instance_type TEXT NOT NULL CHECK (instance_type IN ('cloud', 'on_premise')),
        instance_name TEXT NOT NULL,
        cloud_provider TEXT,
        cloud_region TEXT,
        ip_address TEXT,
        hostname TEXT,
        version TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'syncing', 'offline', 'error')),
        last_sync_at TIMESTAMPTZ,
        sync_partner_id UUID REFERENCES public.deployment_instances(id),
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create AWS deployments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.aws_deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        aws_account_id TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'failed')),
        provisioning_status TEXT DEFAULT 'initializing',
        infrastructure_url TEXT,
        admin_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id)
      )
    `);
    
    // Create AWS billing history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.aws_billing_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        billing_period_start TIMESTAMPTZ NOT NULL,
        billing_period_end TIMESTAMPTZ NOT NULL,
        total_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
        breakdown JSONB DEFAULT '{}',
        aws_account_id TEXT,
        invoice_id TEXT,
        payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON public.tenant_subscriptions(tenant_id)
    `).catch(() => {}); // Ignore if index already exists
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_deployment_instances_tenant ON public.deployment_instances(tenant_id)
    `).catch(() => {}); // Ignore if index already exists
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_deployment_instances_status ON public.deployment_instances(status)
    `).catch(() => {}); // Ignore if index already exists
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_aws_deployments_tenant ON public.aws_deployments(tenant_id)
    `).catch(() => {}); // Ignore if index already exists
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_aws_billing_history_tenant ON public.aws_billing_history(tenant_id)
    `).catch(() => {}); // Ignore if index already exists
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_aws_billing_history_period ON public.aws_billing_history(billing_period_start, billing_period_end)
    `).catch(() => {}); // Ignore if index already exists
    
    // Insert default subscription plans if they don't exist
    await pool.query(`
      INSERT INTO public.subscription_plans (name, display_name, price_monthly, price_yearly, features, deployment_options, is_active)
      VALUES 
        ('starter', 'Starter', 499.00, 4990.00, 
         '{"max_users": 5, "los_adapters": 1, "storage_gb": 10, "api_calls_per_month": 10000}'::jsonb,
         ARRAY['on_premise']::text[],
         true),
        ('professional', 'Professional', 999.00, 9990.00,
         '{"max_users": 25, "los_adapters": 3, "storage_gb": 100, "api_calls_per_month": 100000}'::jsonb,
         ARRAY['on_premise', 'hybrid']::text[],
         true),
        ('enterprise', 'Enterprise', 2499.00, 24990.00,
         '{"max_users": -1, "los_adapters": -1, "storage_gb": 1000, "api_calls_per_month": -1}'::jsonb,
         ARRAY['on_premise', 'hybrid', 'per_lender_aws']::text[],
         true)
      ON CONFLICT (name) DO NOTHING
    `).catch((err) => {
      // Ignore errors if plans already exist or if there's a constraint issue
      console.log('ℹ️  Default subscription plans already exist or could not be created');
    });
    
    // Note: public.users table, indexes, and migrations are created earlier (before profiles)
    
    // Create audit logging tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
        user_email TEXT,
        user_role TEXT,
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        description TEXT,
        changes JSONB,
        metadata JSONB,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        ip_address TEXT,
        user_agent TEXT,
        request_id TEXT,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id)
    `).catch(() => {});
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id)
    `).catch(() => {});
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp)
    `).catch(() => {});
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        token_hash TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        last_activity_at TIMESTAMPTZ DEFAULT now(),
        is_active BOOLEAN DEFAULT true,
        logout_at TIMESTAMPTZ,
        logout_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id)
    `).catch(() => {});
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON public.user_sessions(token_hash)
    `).catch(() => {});
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.failed_login_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        failure_reason TEXT NOT NULL,
        metadata JSONB,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email ON public.failed_login_attempts(email)
    `).catch(() => {});
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_attempted_at ON public.failed_login_attempts(attempted_at)
    `).catch(() => {});
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.data_access_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT NOT NULL,
        contains_pii BOOLEAN DEFAULT false,
        pii_fields TEXT[],
        purpose TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata JSONB,
        accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_data_access_logs_user_id ON public.data_access_logs(user_id)
    `).catch(() => {});
    
    // Create default admin user if it doesn't exist
    try {
      const adminResult = await pool.query(`
        INSERT INTO public.users (email, encrypted_password, full_name, role, is_active)
        VALUES (
          'admin@ailethia.com',
          '$2a$10$vbbt8TWzAGU1Nf5QPom4bu9rxKx.8QqK/COn1HScKq3TysCmYJFlK',
          'Admin User',
          'admin',
          true
        )
        ON CONFLICT (email) DO UPDATE SET
          encrypted_password = EXCLUDED.encrypted_password,
          role = COALESCE(EXCLUDED.role, public.users.role, 'admin'),
          is_active = COALESCE(EXCLUDED.is_active, public.users.is_active, true),
          full_name = COALESCE(EXCLUDED.full_name, public.users.full_name, 'Admin User')
        RETURNING id, email
      `);
      if (adminResult.rows.length > 0) {
        console.log('✅ Admin user created/updated:', adminResult.rows[0].email);
      }
    } catch (err: any) {
      console.warn('⚠️  Error creating admin user:', err.message);
    }
    
    // Create user_preferences table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        preference_key TEXT NOT NULL,
        preference_value JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, preference_key)
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key ON public.user_preferences(user_id, preference_key)
    `).catch(() => {});
    
    console.log('✅ Core tables created');
    
    // Create RAG tables if they don't exist
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.rag_settings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
          embedding_model TEXT DEFAULT 'text-embedding-3-small',
          vector_database TEXT DEFAULT 'pgvector',
          chunk_size INTEGER DEFAULT 1000,
          chunk_overlap INTEGER DEFAULT 200,
          top_k INTEGER DEFAULT 5,
          similarity_threshold NUMERIC DEFAULT 0.7,
          enable_reranking BOOLEAN DEFAULT false,
          reranking_model TEXT,
          context_window INTEGER DEFAULT 8000,
          chat_model TEXT DEFAULT 'gpt-4o-mini',
          voice_model TEXT DEFAULT 'gpt-4o-mini',
          temperature NUMERIC DEFAULT 0.7,
          custom_system_prompt TEXT,
          enable_pii_sanitization BOOLEAN DEFAULT true,
          redact_ssn BOOLEAN DEFAULT true,
          redact_dob BOOLEAN DEFAULT true,
          redact_account_numbers BOOLEAN DEFAULT true,
          allow_employee_names BOOLEAN DEFAULT false,
          log_ai_interactions BOOLEAN DEFAULT true,
          openai_api_key TEXT,
          gemini_api_key TEXT,
          voice_agentic_enabled BOOLEAN DEFAULT false,
          voice_name TEXT DEFAULT 'Aria',
          voice_top_k INTEGER DEFAULT 3,
          voice_similarity_threshold NUMERIC DEFAULT 0.75,
          voice_context_window INTEGER DEFAULT 4000,
          voice_temperature NUMERIC DEFAULT 0.8,
          voice_response_max_length INTEGER DEFAULT 60,
          voice_conversation_memory INTEGER DEFAULT 10,
          voice_rag_enabled BOOLEAN DEFAULT true,
          voice_system_prompt TEXT,
          voice_enable_reranking BOOLEAN DEFAULT false,
          voice_real_time_mode BOOLEAN DEFAULT false,
          allowed_topics TEXT,
          conversation_rules TEXT,
          personality_tone TEXT DEFAULT 'professional',
          personality_style TEXT DEFAULT 'concise',
          personality_custom TEXT,
          knowledge_base_links TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(tenant_id)
        )
      `);
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_settings_tenant_id ON public.rag_settings(tenant_id)
      `).catch(() => {});
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.rag_document_sources (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('upload', 's3', 'sharepoint', 'confluence', 'url', 'api')),
          source_config JSONB NOT NULL DEFAULT '{}',
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'active', 'error', 'paused')),
          document_count INTEGER DEFAULT 0,
          total_chunks INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,
          last_sync_at TIMESTAMPTZ,
          sync_frequency TEXT DEFAULT 'daily' CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'manual')),
          error_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_document_sources_tenant ON public.rag_document_sources(tenant_id)
      `).catch(() => {});
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.rag_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_id UUID NOT NULL REFERENCES public.rag_document_sources(id) ON DELETE CASCADE,
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          file_path TEXT,
          file_type TEXT,
          file_size_bytes INTEGER,
          chunk_count INTEGER DEFAULT 0,
          token_count INTEGER DEFAULT 0,
          metadata JSONB DEFAULT '{}',
          status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'error', 'deleted')),
          error_message TEXT,
          indexed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON public.rag_documents(source_id)
      `).catch(() => {});
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant ON public.rag_documents(tenant_id)
      `).catch(() => {});
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON public.rag_documents(status)
      `).catch(() => {});
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.rag_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL REFERENCES public.rag_documents(id) ON DELETE CASCADE,
          tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          chunk_index INTEGER NOT NULL,
          chunk_text TEXT NOT NULL,
          token_count INTEGER,
          embedding vector(3072),
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `).catch(() => {}); // pgvector extension might not be available
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_document ON public.rag_embeddings(document_id)
      `).catch(() => {});
      
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_tenant ON public.rag_embeddings(tenant_id)
      `).catch(() => {});
      
      console.log('✅ RAG tables created');
    } catch (ragError) {
      console.warn('⚠️  RAG tables creation warning:', ragError);
    }
    
    // Skip file-based migrations for now to avoid connection pool issues
    // They can be run manually later if needed
    console.log('ℹ️  File-based migrations skipped (run manually if needed)');
  } catch (error) {
    console.error('❌ Migration error:', error);
    // Don't throw - allow server to start even if migrations fail
  }
}

/**
 * Run a migration file from the supabase/migrations directory
 * @param filename - Migration filename (e.g., '20251211000000_agileplan.sql')
 * @param migrationName - Human-readable name for logging
 */
async function runFileMigration(filename: string, migrationName: string) {
  try {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationPath = join(__dirname, '../../../supabase/migrations', filename);
    
    // Read migration file
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Execute migration (split by semicolon and execute each statement)
    // Note: This is a simple approach. For production, consider using a proper migration tool
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));
    
    for (const statement of statements) {
      if (statement.length > 0) {
        try {
          await pool.query(statement);
        } catch (error: any) {
          // Ignore "already exists" errors and constraint violations for idempotency
          const errorMsg = error.message?.toLowerCase() || '';
          if (
            !errorMsg.includes('already exists') &&
            !errorMsg.includes('duplicate') &&
            !errorMsg.includes('relation') &&
            !errorMsg.includes('constraint') &&
            !errorMsg.includes('trigger')
          ) {
            console.warn(`⚠️  ${migrationName} migration statement warning:`, error.message);
          }
        }
      }
    }
    
    console.log(`✅ ${migrationName} migration completed`);
  } catch (error: any) {
    // Migration file might not exist in all environments
    if (error.code === 'ENOENT') {
      console.log(`ℹ️  ${migrationName} migration file not found, skipping`);
    } else {
      console.warn(`⚠️  ${migrationName} migration error:`, error.message);
    }
  }
}

