-- Migration: Auth Configuration
-- Created: 2026-01-30
-- Database: management
--
-- Adds authentication mode configuration to tenants for hybrid/SSO-only support

-- =============================================================================
-- AUTH CONFIG - Add auth mode configuration to tenants
-- =============================================================================
ALTER TABLE coheus_tenants ADD COLUMN IF NOT EXISTS auth_config JSONB DEFAULT '{
  "mode": "hybrid",
  "allow_email_password": true,
  "allow_sso": true,
  "sso_required_for_roles": [],
  "break_glass_enabled": true
}';

-- Add comment for documentation
COMMENT ON COLUMN coheus_tenants.auth_config IS 'Authentication mode configuration: mode (hybrid|sso_preferred|sso_only), allow_email_password, allow_sso, sso_required_for_roles, break_glass_enabled';

-- =============================================================================
-- SSO IDENTITY PROVIDERS - Track configured IdPs per tenant
-- =============================================================================
CREATE TABLE IF NOT EXISTS tenant_identity_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('cognito_saml', 'cognito_oidc', 'direct_saml', 'direct_oidc', 'coheus_bridge')),
  provider_name TEXT NOT NULL,           -- Display name (e.g., 'Corporate Okta')
  cognito_idp_name TEXT,                 -- Cognito IdP identifier (e.g., 'tenant-abc-okta')
  idp_type TEXT,                         -- 'okta', 'azure_ad', 'ping', 'google', 'custom'
  email_domains TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_enabled BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT CHECK (last_test_status IN ('success', 'failed')),
  last_test_error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, cognito_idp_name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_idps_tenant ON tenant_identity_providers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_idps_email_domains ON tenant_identity_providers USING GIN (email_domains);
CREATE INDEX IF NOT EXISTS idx_tenant_idps_enabled ON tenant_identity_providers(is_enabled) WHERE is_enabled = true;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_tenant_identity_providers_updated_at ON tenant_identity_providers;
CREATE TRIGGER trigger_tenant_identity_providers_updated_at
  BEFORE UPDATE ON tenant_identity_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
