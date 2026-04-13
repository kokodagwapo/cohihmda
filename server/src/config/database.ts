import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env in server directory
dotenv.config({ path: join(__dirname, "../.env") });

const { Pool } = pg;

// Lazy initialization - pool is created when first accessed
let poolInstance: pg.Pool | null = null;

// Function to reset the pool (close existing and create new)
export function resetPool(): void {
  if (poolInstance) {
    console.log("Resetting database connection pool...");
    poolInstance.end().catch((err) => {
      console.error("Error closing old pool:", err);
    });
    poolInstance = null;
  }
}

function getPool(): pg.Pool {
  // Force reload of .env to ensure we have latest values
  dotenv.config({ path: join(__dirname, "../.env") });

  if (!poolInstance) {
    const envTrim = (v: string | undefined) =>
      typeof v === "string" ? v.trim() : v;

    // Fix IPv6/IPv4 issue: Use 127.0.0.1 instead of localhost to avoid IPv6 resolution
    // On Windows, localhost can resolve to ::1 (IPv6) which may not be available
    // This only affects localhost - AWS RDS hostnames are used as-is
    const rawHost = envTrim(process.env.DB_HOST) || "localhost";
    const dbHost =
      rawHost === "localhost" || rawHost === "127.0.0.1"
        ? "127.0.0.1"
        : rawHost;

    // Default database connection (for backward compatibility with existing shared DB)
    // Management DB uses a separate connection pool (see managementDatabase.ts)
    const dbName = envTrim(process.env.DB_NAME) || "coheus";

    // Log database connection details (without password) for debugging
    const dbConfig = {
      host: dbHost,
      port: parseInt(envTrim(process.env.DB_PORT) || "5432"),
      database: dbName,
      user: envTrim(process.env.DB_USER) || "postgres",
      password: envTrim(process.env.DB_PASSWORD) || "postgres",
    };

    // Validate required database configuration
    if (!dbConfig.password || dbConfig.password === "postgres") {
      console.warn(
        "⚠️  Database password not set or using default - connection may fail",
      );
    }
    if (!dbConfig.host || dbConfig.host === "localhost") {
      console.warn(
        "⚠️  Database host is localhost - ensure database is running locally",
      );
    }

    console.log("🔌 Database connection config:", {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password ? "***" : "NOT SET",
      hasPassword: !!dbConfig.password,
      ssl: "auto",
    });

    // SSL handling:
    // - AWS RDS commonly requires SSL ("no pg_hba.conf entry ... no encryption" when ssl is off)
    // - Elastic Beanstalk may not set NODE_ENV=production by default
    // - Default: enable SSL for any non-local host, but allow override via DB_SSL
    const dbSslEnv = (process.env.DB_SSL || "").trim().toLowerCase();
    const isLocalHost = dbHost === "127.0.0.1" || dbHost === "localhost";
    const sslEnabled =
      dbSslEnv === "true" || dbSslEnv === "1" || dbSslEnv === "on"
        ? true
        : dbSslEnv === "false" || dbSslEnv === "0" || dbSslEnv === "off"
          ? false
          : !isLocalHost;

    console.log("🔐 Database SSL:", {
      enabled: sslEnabled,
      reason: dbSslEnv
        ? `DB_SSL=${process.env.DB_SSL}`
        : isLocalHost
          ? "local host"
          : "non-local host (default)",
    });

    poolInstance = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      max: 15, // Enough headroom for concurrent audit logging + tenant lookups during job bursts
      min: 2, // Keep a couple warm connections to avoid cold-start timeouts on audit logs
      idleTimeoutMillis: 30000, // 30s idle timeout — balance between releasing and keeping warm
      connectionTimeoutMillis: 15000, // 15 seconds connection timeout
      query_timeout: 60000, // 60 seconds for long-running queries (imports, etc.)
      allowExitOnIdle: false, // Keep min connections alive to prevent timeout errors on audit logging
    });

    // Handle connection errors
    poolInstance.on("error", (err: any) => {
      console.error("Unexpected database pool error:", {
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
    poolInstance.on("connect", async (client) => {
      console.log("✅ New database connection established");
      // Set timezone to UTC for this connection to ensure consistent timestamp handling
      try {
        await client.query("SET timezone = UTC");
        console.log("✅ Database connection timezone set to UTC");
      } catch (err) {
        console.warn("⚠️ Failed to set timezone to UTC:", err);
      }
    });
  }
  return poolInstance;
}

// Helper function to retry database queries
export async function retryQuery<T>(
  queryFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error: any) {
      lastError = error;
      const isConnectionError =
        error?.message?.includes("timeout") ||
        error?.message?.includes("ECONNREFUSED") ||
        error?.message?.includes("connection") ||
        error?.code === "ETIMEDOUT" ||
        error?.code === "ECONNREFUSED";

      if (isConnectionError && attempt < maxRetries) {
        console.warn(
          `⚠️ Database connection attempt ${attempt} failed, retrying in ${delayMs}ms...`,
        );
        // Reset pool on connection errors to force reconnection
        if (attempt === 1) {
          resetPool();
          console.log("🔄 Reset database pool due to connection error");
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Database query failed after retries");
}

/**
 * Check if an error is a database connection error
 * @param error - The error to check
 * @returns true if the error is a connection error
 */
export function isDatabaseConnectionError(error: any): boolean {
  if (!error) return false;

  const errorMessage = error?.message?.toLowerCase() || "";
  const errorCode = error?.code;

  return (
    errorMessage.includes("econnrefused") ||
    errorMessage.includes("etimedout") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("connection") ||
    errorMessage.includes("connect econnrefused") ||
    errorCode === "ECONNREFUSED" ||
    errorCode === "ETIMEDOUT" ||
    errorCode === "ENOTFOUND" ||
    errorCode === "ECONNRESET"
  );
}

/**
 * Handle database errors and return appropriate HTTP response
 * @param error - The database error
 * @param res - Express response object
 * @param defaultMessage - Default error message if not a connection error
 * @returns true if response was sent, false otherwise
 */
export function handleDatabaseError(
  error: any,
  res: any,
  defaultMessage: string = "Internal server error",
): boolean {
  if (isDatabaseConnectionError(error)) {
    console.error("Database connection error:", error);
    res.status(503).json({
      error: "Service temporarily unavailable. Database connection failed.",
      retry: true,
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
    return true;
  }

  // Check for missing relation/table errors only (avoid matching unrelated "function ... does not exist")
  const errorMessage = String(error?.message || "").toLowerCase();
  const missingRelationError =
    error?.code === "42P01" ||
    /relation\s+["'`]?[\w.]+["'`]?\s+does not exist/.test(errorMessage) ||
    /table\s+["'`]?[\w.]+["'`]?\s+does not exist/.test(errorMessage);
  if (missingRelationError) {
    console.error("Database table missing:", error);
    res.status(503).json({
      error:
        "Database not initialized. Please restart the server to run migrations.",
      retry: false,
    });
    return true;
  }

  return false;
}

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return getPool()[prop as keyof pg.Pool];
  },
}) as pg.Pool;

export async function initDatabase(): Promise<void> {
  try {
    // Set timezone to UTC for the initial connection
    await pool.query("SET timezone = UTC");
    await pool.query("SELECT NOW()");
    console.log("✅ Database connected (timezone: UTC)");

    // Initialize management database schema first
    try {
      const { initManagementDatabase } =
        await import("./managementDatabase.js");
      await initManagementDatabase();
    } catch (managementError: any) {
      console.warn(
        "⚠️ Management database initialization warning:",
        managementError.message,
      );
      // Continue - management DB might not exist yet
    }

    // Legacy shared-database migrations: only run for local dev (single-DB mode).
    // In multi-tenant mode (ECS), management and tenant DBs use the proper migration system
    // (server/migrations/management/ and server/migrations/tenant/).
    if (process.env.MULTI_TENANT_ENABLED !== "true") {
      try {
        await runMigrations();
      } catch (migrationError) {
        console.warn(
          "⚠️ Migration warnings (server will continue):",
          migrationError,
        );
      }
    }

    // Force-sync default AI prompt configs on every startup.
    // This ensures code-level prompt changes (system_prompt, model, temperature, max_tokens)
    // are applied to the database. Does NOT overwrite admin-customized user_prompt_template.
    try {
      const { forceSeedDefaultPrompts } =
        await import("../services/promptConfigService.js");
      const upserted = await forceSeedDefaultPrompts();
      if (upserted > 0) {
        console.log(`✅ Synced ${upserted} default AI prompt configuration(s)`);
      }
    } catch (seedError: any) {
      // Non-critical - prompts will fall back to hardcoded defaults
      console.warn("⚠️ AI prompt seed skipped:", seedError.message);
    }
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
}

// Note: Derived field functions (calculate_revenue, calculate_turn_time, etc.)
// were removed — they were never called by application code.
// Revenue/margin calculations use inline SQL in scorecard-utils.ts.

async function runMigrations() {
  try {
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
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('tenant_admin', 'user')),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Add missing columns if table already exists (migration)
    await pool
      .query(
        `
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
          ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('tenant_admin', 'user'));
        END IF;
        
        -- Update existing role constraint if it exists to allow all roles
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_schema = 'public' 
          AND table_name = 'users' 
          AND constraint_name = 'users_role_check'
        ) THEN
          ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
          ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('tenant_admin', 'user'));
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
    `,
      )
      .catch((err) => {
        console.warn("⚠️  Error adding columns to users table:", err.message);
      });

    // Create indexes for users table
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON public.users(tenant_id)
    `,
      )
      .catch(() => {});

    // Migrate password_hash to encrypted_password if needed
    await pool
      .query(
        `
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
    `,
      )
      .catch(() => {});

    // Update role constraint to allow all valid roles
    await pool
      .query(
        `
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
          CHECK (role IN ('tenant_admin', 'user'));
      END $$;
    `,
      )
      .catch((err) => {
        console.warn("⚠️  Error updating role constraint:", err.message);
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
        console.log(
          "✅ Default tenant created:",
          defaultTenantResult.rows[0].name,
        );
      }
    } catch (err: any) {
      console.warn("⚠️  Error creating default tenant:", err.message);
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
        -- Encompass-specific fields
        encompass_secret_arn TEXT,
        encompass_instance_id TEXT,
        encompass_sa_username TEXT,
        encompass_extraction_method TEXT CHECK (encompass_extraction_method IN ('partner', 'ropc', 'api')),
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
    // Includes all source fields from CoheusDataDictionary.xml
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        loan_id TEXT NOT NULL,
        
        -- Core loan fields
        borrower_name TEXT,
        loan_amount DECIMAL(12,2),
        loan_type TEXT,
        loan_program TEXT,
        loan_purpose TEXT,
        loan_term INTEGER,
        loan_number TEXT,
        loan_folder TEXT,
        loan_source TEXT,
        status TEXT,
        current_loan_status TEXT,
        current_milestone TEXT,
        current_status_date DATE,
        
        -- Financial fields
        interest_rate DECIMAL(5,3),
        base_loan_amount DECIMAL(12,2),
        sales_price DECIMAL(12,2),
        appraised_value DECIMAL(12,2),
        ltv_ratio DECIMAL(5,2),
        cltv DECIMAL(5,2),
        hcltv DECIMAL(5,2),
        be_dti_ratio DECIMAL(5,2),
        income_total_mo_income DECIMAL(12,2),
        assets_subtotal_liquid_assets DECIMAL(12,2),
        combined_assets_all_borrowers DECIMAL(12,2),
        number_of_months_reserves INTEGER,
        
        -- Property fields
        property_street TEXT,
        property_city TEXT,
        property_county TEXT,
        property_state TEXT,
        property_zip TEXT,
        number_of_units INTEGER,
        property_type TEXT,
        occupancy_type TEXT,
        property_rights TEXT,
        lien_position TEXT,
        county_fips_code TEXT,
        state_fips_code TEXT,
        
        -- Date fields (all as DATE type for straightforward queries)
        application_date DATE,
        gfe_application_date DATE,
        started_date DATE,
        pre_approval_date DATE,
        disclosure_prep_date DATE,
        signed_date DATE,
        scrubbed_date DATE,
        processing_date DATE,
        submitted_to_processing_date DATE,
        submitted_to_underwriting_date DATE,
        submittal_date DATE,
        cond_approval_date DATE,
        conditional_approval_date DATE,
        resubmittal_date DATE,
        approval_date DATE,
        uw_final_approval_date DATE,
        uw_denied_date DATE,
        uw_suspended_date DATE,
        ctc_date DATE,
        ready_for_docs_date DATE,
        closer_assignment_date DATE,
        docs_out_date DATE,
        docs_signing_date DATE,
        doc_preparation_date DATE,
        closing_date DATE,
        estimated_closing_date DATE,
        funding_date DATE,
        fund_date TIMESTAMPTZ,
        funds_sent_date DATE,
        shipped_date DATE,
        investor_purchase_date DATE,
        purchased_date DATE,
        reconciled_date DATE,
        completion_date DATE,
        post_closing_date DATE,
        lock_date TIMESTAMPTZ,
        lock_expiration_date DATE,
        buy_side_lock_date DATE,
        buy_side_lock_days INTEGER,
        buy_side_lock_expiration DATE,
        sell_side_lock_days INTEGER,
        sell_side_lock_expiration DATE,
        investor_lock_date DATE,
        last_rate_set_date DATE,
        rate_lock_sell_side_last_rate_set_date DATE,
        loan_estimate_sent_date DATE,
        loan_estimate_received_date DATE,
        revised_le_sent_date DATE,
        revised_le_received_date DATE,
        initial_disclosure_due_date DATE,
        gfe_initial_gfe_disclosure_provided_date DATE,
        til_intl_disclosure_provided_date DATE,
        closing_disclosure_sent_date DATE,
        closing_disclosure_received_date DATE,
        revised_cd_sent_date DATE,
        revised_cd_received_date DATE,
        closing_docs_1003_signature_date DATE,
        loan_first_payment_date DATE,
        maturity_date DATE,
        note_date DATE,
        first_rate_adjustment_date DATE,
        credit_pull_date TIMESTAMPTZ,
        appraisal_ordered_date DATE,
        appraisal_completed_date DATE,
        appraisal_received_date DATE,
        flood_certification_date DATE,
        au_decision_date DATE,
        repurchase_date DATE,
        date_sold_to_third_party DATE,
        date_warehoused DATE,
        last_modified_date TIMESTAMPTZ,
        appt_reset_date DATE,
        appt_set_date DATE,
        
        -- Revenue fields
        origination_points DECIMAL(12,2),
        orig_fee_borr_pd DECIMAL(12,2),
        orig_fees_seller DECIMAL(12,2),
        cd_lender_credits DECIMAL(12,2),
        cd_applied_cure DECIMAL(12,2),
        pa_sell_amt DECIMAL(12,2),
        pa_srp_amt DECIMAL(12,2),
        pa_payout_1 DECIMAL(12,2),
        pa_payout_2 DECIMAL(12,2),
        pa_payout_3 DECIMAL(12,2),
        pa_payout_4 DECIMAL(12,2),
        pa_payout_5 DECIMAL(12,2),
        pa_payout_6 DECIMAL(12,2),
        pa_payout_7 DECIMAL(12,2),
        pa_payout_8 DECIMAL(12,2),
        pa_payout_9 DECIMAL(12,2),
        pa_payout_10 DECIMAL(12,2),
        pa_payout_11 DECIMAL(12,2),
        pa_payout_12 DECIMAL(12,2),
        net_buy DECIMAL(12,2),
        net_sell DECIMAL(12,2),
        rate_lock_buy_side_net_buy_rate DECIMAL(12,2),
        rate_lock_buy_side_base_price_rate DECIMAL(12,2),
        rate_lock_buy_side_adjusted_buy_price DECIMAL(12,2),
        srp_from_investor DECIMAL(12,2),
        discount_yield_spread_premium DECIMAL(12,2),
        corporate_price_concession DECIMAL(12,2),
        branch_price_concession DECIMAL(12,2),
        service_fee DECIMAL(12,2),
        guaranty_fee DECIMAL(12,2),
        msr_value DECIMAL(12,2),
        
        -- Rate lock profit margin adjustments
        rate_lock_buy_side_profit_margin_adjustment_1_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_1_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_2_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_2_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_3_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_3_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_4_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_4_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_5_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_5_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_6_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_6_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_7_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_7_rate DECIMAL(12,2),
        rate_lock_buy_side_profit_margin_adjustment_8_desc TEXT,
        rate_lock_buy_side_profit_margin_adjustment_8_rate DECIMAL(12,2),
        
        -- ARM fields
        arm_program TEXT,
        margin DECIMAL(5,3),
        margin_index TEXT,
        lookback TEXT,
        first_change_months INTEGER,
        maximum_rate_adjustment_cap DECIMAL(5,3),
        adjustment_period_months INTEGER,
        first_rate_adjustment_cap DECIMAL(5,3),
        floor_rate DECIMAL(5,3),
        life_cap DECIMAL(5,3),
        rounding TEXT,
        description_of_the_arm_index_type TEXT,
        interest_only_payments BOOLEAN,
        number_of_months_interest_only_payments INTEGER,
        balloon_payments BOOLEAN,
        pi_payment DECIMAL(12,2),
        piti_payment DECIMAL(12,2),
        
        -- PMI fields
        pmi_flag BOOLEAN,
        mortgage_insurance_company_name TEXT,
        private_mortgage_insurance_indicator TEXT,
        mi_percent_coverage_1 DECIMAL(5,2),
        mi_coverage_1_months INTEGER,
        mi_percent_coverage_2 DECIMAL(5,2),
        mi_coverage_2_months INTEGER,
        mi_cancel_percent DECIMAL(5,2),
        
        -- HELOC fields
        heloc_initial_draw DECIMAL(12,2),
        heloc_draw_period INTEGER,
        heloc_repayment_period INTEGER,
        
        -- Credit/Score fields
        fico_score INTEGER,
        cu_risk_score INTEGER,
        freddie_loan_level_credit_score_value INTEGER,
        freddie_loan_level_credit_score_method TEXT,
        
        -- Underwriting fields
        underwriter_risk_assess_type TEXT,
        underwriter_risk_assess_aus_recomm TEXT,
        underwriting_description TEXT,
        underwriting_aus_source TEXT,
        underwriting_aus_number TEXT,
        number_of_conditions INTEGER,
        fannie_au_decision TEXT,
        fannie_property_valuation_form_type TEXT,
        freddie_au_decision TEXT,
        freddie_avm_model_name_type_other_description TEXT,
        freddie_property_valuation_form_type TEXT,
        freddie_underwriting_type_other TEXT,
        property_valuation_method_type TEXT,
        property_valuation_effective_date DATE,
        
        -- Borrower fields
        borr_employer TEXT,
        borr_position TEXT,
        borr_position_2nd TEXT,
        borr_yrs_on_job INTEGER,
        borr_yrs_on_job_2nd INTEGER,
        borr_self_employed BOOLEAN,
        borr_self_employed_2nd BOOLEAN,
        co_borr_employer TEXT,
        co_borr_position TEXT,
        co_borr_yrs_on_job INTEGER,
        co_borr_self_employed BOOLEAN,
        borrower_type TEXT,
        co_borrower_type TEXT,
        co_borrower_mailing_address_is_same_as_the_property_address BOOLEAN,
        borrower_mailing_address_is_same_as_the_property_address BOOLEAN,
        
        -- Team member IDs (stored as TEXT, can reference employees table)
        loan_officer_id UUID,
        loan_officer TEXT,
        legacy_loan_officer_id TEXT,
        loan_interviewer TEXT,
        loan_processor_id TEXT,
        processor TEXT,
        underwriter_id TEXT,
        underwriter TEXT,
        closer_id TEXT,
        closer TEXT,
        account_executive TEXT,
        
        -- Branch/Org fields
        branch TEXT,
        orgid TEXT,
        broker_lender_name TEXT,
        referral_name TEXT,
        warehouse_co_name TEXT,
        investor TEXT,
        investor_status TEXT,
        
        -- Channel fields
        channel TEXT,
        
        -- NMLS fields
        company_nmls_id TEXT,
        nmls_id TEXT,
        
        -- Loan details
        product_type TEXT,
        mers_min TEXT,
        hedged_loan BOOLEAN,
        lock_days INTEGER,
        total_mortgaged_properties_count INTEGER,
        
        -- QM/ATR fields
        exempt_from_reg_z BOOLEAN,
        atr_loan_type TEXT,
        qm_loan_type TEXT,
        safe_harbor TEXT,
        meets_agency_gse_qm BOOLEAN,
        
        -- HMDA fields
        interest_only_indicator BOOLEAN,
        business_or_commercial_purpose BOOLEAN,
        
        -- Refinance fields
        refinance_cash_out_type TEXT,
        
        -- Fee fields (HUD line items)
        fee_details_line_804_borrower_amount_appraisal_fee DECIMAL(12,2),
        fee_details_line_804_seller_amount_appraisal_fee DECIMAL(12,2),
        fee_details_line_805_borrower_amount_credit_report DECIMAL(12,2),
        fee_details_line_805_seller_amount_credit_report DECIMAL(12,2),
        fee_details_line_807_borrower_amount_flood_cert DECIMAL(12,2),
        fee_details_line_807_seller_amount_flood_cert DECIMAL(12,2),
        fee_details_line_804_borrower_poc_amount_appraisal DECIMAL(12,2),
        fee_details_line_804_seller_poc_amount_appraisal DECIMAL(12,2),
        fee_details_line_804_broker_poc_amount_appraisal DECIMAL(12,2),
        fee_details_line_804_lender_poc_amount_appraisal DECIMAL(12,2),
        fee_details_line_804_other_poc_amount_appraisal DECIMAL(12,2),
        fee_details_line_805_borrower_poc_amount_cred_report DECIMAL(12,2),
        fee_details_line_805_seller_poc_amount_cred_report DECIMAL(12,2),
        fee_details_line_805_broker_poc_amount_cred_report DECIMAL(12,2),
        fee_details_line_805_lender_poc_amount_cred_report DECIMAL(12,2),
        fee_details_line_805_other_poc_amount_cred_report DECIMAL(12,2),
        fee_details_line_807_borrower_poc_amount_flood_cert DECIMAL(12,2),
        fee_details_line_807_seller_poc_amount_flood_cert DECIMAL(12,2),
        fee_details_line_807_broker_poc_amount_flood_cert DECIMAL(12,2),
        fee_details_line_807_lender_poc_amount_flood_cert DECIMAL(12,2),
        fee_details_line_807_other_poc_amount_flood_cert DECIMAL(12,2),
        fee_details_line_804_appraisal_fee_pac DECIMAL(12,2),
        fee_details_line_805_credit_report_fee_pac DECIMAL(12,2),
        fee_details_line_807_flood_certification_fee_pac DECIMAL(12,2),
        
        -- Compliance/Mavent fields
        mavent_gse_result TEXT,
        mavent_high_cost_result TEXT,
        mavent_enterprise_result TEXT,
        mavent_atr_qm_result TEXT,
        mavent_tila_tolerance_result TEXT,
        mavent_nmls_licensing_result TEXT,
        mavent_state_rules_result TEXT,
        mavent_hmda_result TEXT,
        mavent_hpml_result TEXT,
        mavent_license_reviewer_result TEXT,
        mavent_other_result TEXT,
        mavent_overall_result TEXT,
        
        -- Document fields
        document_type TEXT,
        du_lp_case_id TEXT,
        
        -- GFE disclosure dates
        gfe_initial_gfe_disclosure_affiliated_business_disclosure_provided_date DATE,
        gfe_initial_gfe_disclosure_charm_booklet_provided_date DATE,
        gfe_initial_gfe_disclosure_hud_special_booklet_provided_date DATE,
        gfe_initial_gfe_disclosure_heloc_brochure_provided_date DATE,
        
        -- Other fields
        guid TEXT,
        encompass_instance TEXT,
        uw_touches INTEGER,
        cycle_time_days INTEGER,
        
        -- Metadata
        raw_data JSONB,
        metadata JSONB DEFAULT '{}',
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

    // Create Encompass field swaps table (for client-specific field mappings)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.encompass_field_swaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        los_connection_id UUID REFERENCES public.los_connections(id) ON DELETE CASCADE,
        coheus_alias VARCHAR(255) NOT NULL,
        encompass_field_id VARCHAR(255) NOT NULL,
        swap_type VARCHAR(50) DEFAULT 'Standard' CHECK (swap_type IN ('Standard', 'Profitability')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, los_connection_id, coheus_alias, swap_type)
      )
    `);

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_tenant ON public.encompass_field_swaps(tenant_id)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_connection ON public.encompass_field_swaps(los_connection_id)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_alias ON public.encompass_field_swaps(coheus_alias)
    `,
      )
      .catch(() => {});

    // Create Encompass token cache table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.encompass_token_cache (
        cache_key VARCHAR(255) PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_token_cache_expires ON public.encompass_token_cache(expires_at)
    `,
      )
      .catch(() => {});

    // Create Encompass concurrency metrics table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.encompass_concurrency_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
        los_connection_id UUID REFERENCES public.los_connections(id) ON DELETE SET NULL,
        limit_value INTEGER NOT NULL,
        remaining INTEGER NOT NULL,
        utilized INTEGER NOT NULL,
        utilization_ratio DECIMAL(5,4) NOT NULL,
        exceeded_threshold BOOLEAN NOT NULL,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_concurrency_tenant ON public.encompass_concurrency_metrics(tenant_id, timestamp)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_encompass_concurrency_connection ON public.encompass_concurrency_metrics(los_connection_id, timestamp)
    `,
      )
      .catch(() => {});

    // Add indexes for frequently queried loan fields
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_application_date ON public.loans(application_date) WHERE application_date IS NOT NULL
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_closing_date ON public.loans(closing_date) WHERE closing_date IS NOT NULL
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_funding_date ON public.loans(funding_date) WHERE funding_date IS NOT NULL
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_loan_type ON public.loans(loan_type) WHERE loan_type IS NOT NULL
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_current_loan_status ON public.loans(current_loan_status) WHERE current_loan_status IS NOT NULL
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_loans_branch ON public.loans(branch) WHERE branch IS NOT NULL
    `,
      )
      .catch(() => {});

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
    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON public.tenant_subscriptions(tenant_id)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_deployment_instances_tenant ON public.deployment_instances(tenant_id)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_deployment_instances_status ON public.deployment_instances(status)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_aws_deployments_tenant ON public.aws_deployments(tenant_id)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_aws_billing_history_tenant ON public.aws_billing_history(tenant_id)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_aws_billing_history_period ON public.aws_billing_history(billing_period_start, billing_period_end)
    `,
      )
      .catch(() => {}); // Ignore if index already exists

    // Insert default subscription plans if they don't exist
    await pool
      .query(
        `
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
    `,
      )
      .catch((err) => {
        // Ignore errors if plans already exist or if there's a constraint issue
        console.log(
          "ℹ️  Default subscription plans already exist or could not be created",
        );
      });

    // Note: public.users table, indexes, and migrations are created earlier (before profiles)

    // Create audit logging tables
    // Note: user_id does NOT have a foreign key because users can be in management DB (coheus_users)
    // or tenant DBs (tenant_*.users). We store the user_id as a UUID for reference but don't enforce FK.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        user_email TEXT,
        user_role TEXT,
        tenant_id UUID,
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

    // Drop foreign key constraints if they exist (for migration from older schema)
    await pool
      .query(
        `
      DO $$ BEGIN
        ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
        ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_fkey;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON public.audit_logs(tenant_id)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp)
    `,
      )
      .catch(() => {});

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

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON public.user_sessions(token_hash)
    `,
      )
      .catch(() => {});

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

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email ON public.failed_login_attempts(email)
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_attempted_at ON public.failed_login_attempts(attempted_at)
    `,
      )
      .catch(() => {});

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

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_data_access_logs_user_id ON public.data_access_logs(user_id)
    `,
      )
      .catch(() => {});

    // Create user_preferences table
    // Note: No FK to users table since users are now in coheus_users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        preference_key TEXT NOT NULL,
        preference_value JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, preference_key)
      )
    `);

    // Drop old FK constraint if it exists (migration from old schema)
    await pool
      .query(
        `
      ALTER TABLE public.user_preferences 
      DROP CONSTRAINT IF EXISTS user_preferences_user_id_fkey
    `,
      )
      .catch(() => {});

    await pool
      .query(
        `
      CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key ON public.user_preferences(user_id, preference_key)
    `,
      )
      .catch(() => {});

    console.log("✅ Core tables created");

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
          chat_model TEXT DEFAULT 'gpt-5.4-mini',
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

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_settings_tenant_id ON public.rag_settings(tenant_id)
      `,
        )
        .catch(() => {});

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

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_document_sources_tenant ON public.rag_document_sources(tenant_id)
      `,
        )
        .catch(() => {});

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

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON public.rag_documents(source_id)
      `,
        )
        .catch(() => {});

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_documents_tenant ON public.rag_documents(tenant_id)
      `,
        )
        .catch(() => {});

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON public.rag_documents(status)
      `,
        )
        .catch(() => {});

      await pool
        .query(
          `
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
      `,
        )
        .catch(() => {}); // pgvector extension might not be available

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_document ON public.rag_embeddings(document_id)
      `,
        )
        .catch(() => {});

      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_rag_embeddings_tenant ON public.rag_embeddings(tenant_id)
      `,
        )
        .catch(() => {});

      console.log("✅ RAG tables created");
    } catch (ragError) {
      console.warn("⚠️  RAG tables creation warning:", ragError);
    }

    // Skip file-based migrations for now to avoid connection pool issues
    // They can be run manually later if needed
    console.log("ℹ️  File-based migrations skipped (run manually if needed)");
  } catch (error) {
    console.error("❌ Migration error:", error);
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
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const migrationPath = join(
      __dirname,
      "../../../supabase/migrations",
      filename,
    );

    // Read migration file
    const migrationSQL = readFileSync(migrationPath, "utf-8");

    // Execute migration (split by semicolon and execute each statement)
    // Note: This is a simple approach. For production, consider using a proper migration tool
    const statements = migrationSQL
      .split(";")
      .map((s) => s.trim())
      .filter(
        (s) => s.length > 0 && !s.startsWith("--") && !s.startsWith("COMMENT"),
      );

    for (const statement of statements) {
      if (statement.length > 0) {
        try {
          await pool.query(statement);
        } catch (error: any) {
          // Ignore "already exists" errors and constraint violations for idempotency
          const errorMsg = error.message?.toLowerCase() || "";
          if (
            !errorMsg.includes("already exists") &&
            !errorMsg.includes("duplicate") &&
            !errorMsg.includes("relation") &&
            !errorMsg.includes("constraint") &&
            !errorMsg.includes("trigger")
          ) {
            console.warn(
              `⚠️  ${migrationName} migration statement warning:`,
              error.message,
            );
          }
        }
      }
    }

    console.log(`✅ ${migrationName} migration completed`);
  } catch (error: any) {
    // Migration file might not exist in all environments
    if (error.code === "ENOENT") {
      console.log(`ℹ️  ${migrationName} migration file not found, skipping`);
    } else {
      console.warn(`⚠️  ${migrationName} migration error:`, error.message);
    }
  }
}
