-- Migration: SSO Configuration
-- Created: 2026-01-30
-- Database: tenant
--
-- Creates SSO configuration table for tenant-level SSO settings

-- =============================================================================
-- SSO_CONFIGS - Tenant SSO configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('cognito_saml', 'cognito_oidc', 'direct_saml', 'direct_oidc', 'coheus_bridge')),
  is_enabled BOOLEAN DEFAULT false,
  is_primary BOOLEAN DEFAULT false,
  
  -- Cognito-specific (recommended for SaaS)
  cognito_idp_name TEXT,              -- e.g., 'tenant-abc-okta'
  cognito_idp_type TEXT,              -- 'okta', 'azure_ad', 'ping', 'google', 'custom'
  
  -- Direct SAML (for self-hosted without Cognito)
  idp_entity_id TEXT,
  idp_sso_url TEXT,
  idp_slo_url TEXT,
  idp_certificate TEXT,
  
  -- Direct OIDC (for self-hosted without Cognito)
  oidc_client_id TEXT,
  oidc_client_secret_encrypted TEXT,
  oidc_issuer_url TEXT,
  oidc_scopes TEXT[] DEFAULT ARRAY['openid', 'email', 'profile'],
  
  -- Coheus Bridge (legacy Qlik SSO)
  qlik_user_directory TEXT,
  qlik_virtual_proxy TEXT,
  
  -- Attribute mapping (IdP claims -> Cohi fields)
  attribute_mapping JSONB DEFAULT '{
    "email": "email",
    "given_name": "first_name",
    "family_name": "last_name",
    "name": "full_name",
    "custom:role": "role",
    "custom:encompass_user_id": "encompass_user_id",
    "custom:branch": "branch"
  }',
  
  -- Email domain routing
  email_domains TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- SP metadata (for SAML)
  sp_entity_id TEXT,
  sp_acs_url TEXT,
  sp_slo_url TEXT,
  sp_metadata_url TEXT,
  
  -- Test results
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT CHECK (last_test_status IN ('success', 'failed')),
  last_test_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_configs_provider ON sso_configs(provider);
CREATE INDEX IF NOT EXISTS idx_sso_configs_enabled ON sso_configs(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_sso_configs_email_domains ON sso_configs USING GIN (email_domains);
CREATE INDEX IF NOT EXISTS idx_sso_configs_cognito_idp ON sso_configs(cognito_idp_name) WHERE cognito_idp_name IS NOT NULL;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_sso_configs_updated_at ON sso_configs;
CREATE TRIGGER trigger_sso_configs_updated_at
  BEFORE UPDATE ON sso_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SSO_LOGIN_HISTORY - Track SSO login attempts for troubleshooting
-- =============================================================================
CREATE TABLE IF NOT EXISTS sso_login_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  provider TEXT NOT NULL,
  cognito_idp_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  error_code TEXT,
  ip_address TEXT,
  user_agent TEXT,
  idp_subject TEXT,           -- IdP's sub claim
  idp_session_id TEXT,        -- For debugging
  attributes_received JSONB,  -- Raw attributes from IdP (sanitized)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sso_login_history_user ON sso_login_history(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sso_login_history_email ON sso_login_history(user_email);
CREATE INDEX IF NOT EXISTS idx_sso_login_history_status ON sso_login_history(status);
CREATE INDEX IF NOT EXISTS idx_sso_login_history_created ON sso_login_history(created_at DESC);

-- Keep only last 90 days of history (can be cleaned up by scheduled job)
COMMENT ON TABLE sso_login_history IS 'SSO login history for troubleshooting. Recommend pruning records older than 90 days.';
