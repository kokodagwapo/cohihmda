-- Migration: Initial Management Database Schema
-- Created: 2026-01-29
-- Database: management
--
-- This migration creates the core tables for the Coheus management database.
-- The management database stores:
-- - Tenant registry (coheus_tenants)
-- - Platform users/super admins (coheus_users)
-- - Tenant API keys
-- - Subscriptions and billing
-- - Deployment tracking

-- =============================================================================
-- COHEUS_TENANTS - Central tenant registry
-- =============================================================================
CREATE TABLE IF NOT EXISTS coheus_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  database_name TEXT UNIQUE NOT NULL,
  database_host TEXT NOT NULL,
  database_port INTEGER DEFAULT 5432,
  database_user TEXT NOT NULL,
  database_password_encrypted TEXT NOT NULL,
  cluster_id TEXT,  -- Aurora cluster identifier for multi-cluster setups
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted', 'provisioning')),
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws')),
  aws_account_id TEXT,
  rds_instance_id TEXT,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that may be missing if table was created by old init code
DO $$
BEGIN
  -- Add cluster_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'coheus_tenants' AND column_name = 'cluster_id') THEN
    ALTER TABLE coheus_tenants ADD COLUMN cluster_id TEXT;
  END IF;
  
  -- Add deployment_type if missing (with default for existing rows)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'coheus_tenants' AND column_name = 'deployment_type') THEN
    ALTER TABLE coheus_tenants ADD COLUMN deployment_type TEXT DEFAULT 'cloud';
    ALTER TABLE coheus_tenants ADD CONSTRAINT coheus_tenants_deployment_type_check 
      CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws'));
  END IF;
  
  -- Add aws_account_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'coheus_tenants' AND column_name = 'aws_account_id') THEN
    ALTER TABLE coheus_tenants ADD COLUMN aws_account_id TEXT;
  END IF;
  
  -- Add rds_instance_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'coheus_tenants' AND column_name = 'rds_instance_id') THEN
    ALTER TABLE coheus_tenants ADD COLUMN rds_instance_id TEXT;
  END IF;
  
  -- Add settings if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'coheus_tenants' AND column_name = 'settings') THEN
    ALTER TABLE coheus_tenants ADD COLUMN settings JSONB DEFAULT '{}';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coheus_tenants_slug ON coheus_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_coheus_tenants_status ON coheus_tenants(status);
CREATE INDEX IF NOT EXISTS idx_coheus_tenants_cluster ON coheus_tenants(cluster_id) WHERE cluster_id IS NOT NULL;

-- =============================================================================
-- COHEUS_USERS - Platform-level users (super admins, support, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS coheus_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  encrypted_password TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'platform_admin', 'support')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  mfa_enabled BOOLEAN DEFAULT false,
  mfa_secret TEXT,
  password_changed_at TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coheus_users_email ON coheus_users(email);
CREATE INDEX IF NOT EXISTS idx_coheus_users_role ON coheus_users(role);
CREATE INDEX IF NOT EXISTS idx_coheus_users_active ON coheus_users(is_active) WHERE is_active = true;

-- =============================================================================
-- TENANT_API_KEYS - Encrypted API keys per tenant
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  openai_api_key_encrypted TEXT,
  gemini_api_key_encrypted TEXT,
  anthropic_api_key_encrypted TEXT,
  other_keys_encrypted JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_api_keys_tenant ON tenant_api_keys(tenant_id);

-- =============================================================================
-- TENANT_SUBSCRIPTIONS - Billing and subscription info
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  plan_id UUID,
  plan_name TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'paused')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws', 'hybrid')),
  monthly_loan_limit INTEGER,
  monthly_api_calls_limit INTEGER,
  features_enabled JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_stripe ON tenant_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status ON tenant_subscriptions(status);

-- =============================================================================
-- TENANT_DEPLOYMENTS - Deployment tracking for multi-region/hybrid
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  deployment_type TEXT NOT NULL CHECK (deployment_type IN ('cloud', 'on_premise', 'per_lender_aws')),
  instance_type TEXT,
  instance_name TEXT,
  cloud_provider TEXT,
  cloud_region TEXT,
  aws_account_id TEXT,
  rds_instance_id TEXT,
  ip_address TEXT,
  hostname TEXT,
  version TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'active', 'syncing', 'offline', 'error', 'terminated')),
  last_sync_at TIMESTAMPTZ,
  last_health_check_at TIMESTAMPTZ,
  health_status TEXT DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_deployments_tenant ON tenant_deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_deployments_status ON tenant_deployments(status);

-- =============================================================================
-- USER_TENANT_MAPPINGS - Maps users to tenants (for multi-tenant access)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_tenant_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,  -- Can be from coheus_users or tenant users table
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer', 'super_admin', 'tenant_admin', 'loan_officer', 'processor')),
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_user ON user_tenant_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_tenant ON user_tenant_mappings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_tenant_mappings_primary ON user_tenant_mappings(user_id, is_primary) WHERE is_primary = true;

-- =============================================================================
-- MARKET_RATES - Global mortgage market rates (for fallout prediction)
-- =============================================================================
CREATE TABLE IF NOT EXISTS market_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date DATE NOT NULL UNIQUE,
  rate DECIMAL(10, 4) NOT NULL,
  series_id TEXT NOT NULL DEFAULT 'OBMMIC30YF',
  source TEXT DEFAULT 'FRED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_rates_date ON market_rates(rate_date);
CREATE INDEX IF NOT EXISTS idx_market_rates_series ON market_rates(series_id);

-- =============================================================================
-- AUDIT_LOG - Platform-level audit logging
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_email TEXT,
  tenant_id UUID REFERENCES coheus_tenants(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- =============================================================================
-- TRIGGERS - Auto-update updated_at timestamps
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN 
    SELECT table_name FROM information_schema.columns 
    WHERE table_schema = 'public' AND column_name = 'updated_at'
    AND table_name IN ('coheus_tenants', 'coheus_users', 'tenant_api_keys', 
                       'tenant_subscriptions', 'tenant_deployments', 'user_tenant_mappings', 'market_rates')
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trigger_%I_updated_at ON %I;
      CREATE TRIGGER trigger_%I_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    ', t, t, t, t);
  END LOOP;
END;
$$;
