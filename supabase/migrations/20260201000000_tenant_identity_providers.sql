-- ============================================================================
-- Tenant Identity Providers (SSO Configuration)
-- ============================================================================
-- This table maps email domains to tenants and their configured identity providers.
-- When a user enters their email on the login page:
--   1. System extracts the email domain (e.g., "acmemortgage.com")
--   2. Looks up which tenant owns that domain and their IdP
--   3. Routes the user to authenticate via their corporate SSO
--
-- Each tenant can have multiple IdPs (e.g., Okta for employees, SAML for contractors)
-- The is_primary flag determines which IdP is used by default for the domain.
-- ============================================================================

-- Run in management database
-- This table should be created in coheus_management database

CREATE TABLE IF NOT EXISTS tenant_identity_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES coheus_tenants(id) ON DELETE CASCADE,
    
    -- Provider configuration
    provider_type VARCHAR(50) NOT NULL DEFAULT 'cognito_federated',  -- cognito_federated, cognito_native, custom
    idp_type VARCHAR(50),  -- okta, azure_ad, google, saml, oidc
    cognito_idp_name VARCHAR(255),  -- Name of the IdP in Cognito (e.g., "AcmeMortgageOkta")
    
    -- Domain mapping - which email domains route to this IdP
    email_domains TEXT[] NOT NULL DEFAULT '{}',  -- e.g., ['acmemortgage.com', 'acme.com']
    
    -- Configuration
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    is_primary BOOLEAN NOT NULL DEFAULT false,  -- Primary IdP for ambiguous cases
    
    -- IdP-specific settings (stored as JSON)
    config JSONB DEFAULT '{}',  -- metadata_url, client_id for OIDC, etc.
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    
    -- Constraints
    CONSTRAINT unique_tenant_idp_name UNIQUE (tenant_id, cognito_idp_name)
);

-- Index for fast domain lookups
CREATE INDEX IF NOT EXISTS idx_tenant_idp_email_domains 
    ON tenant_identity_providers USING GIN (email_domains);

-- Index for tenant lookups
CREATE INDEX IF NOT EXISTS idx_tenant_idp_tenant_id 
    ON tenant_identity_providers (tenant_id);

-- Ensure only one primary IdP per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_idp_primary 
    ON tenant_identity_providers (tenant_id) 
    WHERE is_primary = true;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_tenant_idp_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tenant_idp_updated ON tenant_identity_providers;
CREATE TRIGGER trigger_tenant_idp_updated
    BEFORE UPDATE ON tenant_identity_providers
    FOR EACH ROW
    EXECUTE FUNCTION update_tenant_idp_timestamp();

-- ============================================================================
-- SSO Audit Log
-- Track all SSO authentication attempts for security and debugging
-- ============================================================================
CREATE TABLE IF NOT EXISTS sso_auth_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User info (may be null for failed attempts before user identified)
    user_id UUID,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    
    -- Provider info
    provider VARCHAR(50) NOT NULL,  -- cognito, okta, azure_ad, etc.
    cognito_idp_name VARCHAR(255),  -- Which federated IdP was used
    
    -- Request details
    idp_subject VARCHAR(255),  -- Subject/ID from the IdP
    tenant_id UUID,
    
    -- Result
    status VARCHAR(50) NOT NULL,  -- success, failed, blocked, jit_created
    error_message TEXT,
    
    -- Metadata
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for querying audit logs
CREATE INDEX IF NOT EXISTS idx_sso_auth_logs_user_email 
    ON sso_auth_logs (user_email);
CREATE INDEX IF NOT EXISTS idx_sso_auth_logs_created_at 
    ON sso_auth_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sso_auth_logs_status 
    ON sso_auth_logs (status);
CREATE INDEX IF NOT EXISTS idx_sso_auth_logs_tenant_id 
    ON sso_auth_logs (tenant_id);

-- ============================================================================
-- Add auth_config to tenants if not exists
-- Controls tenant-level authentication settings
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'coheus_tenants' AND column_name = 'auth_config'
    ) THEN
        ALTER TABLE coheus_tenants 
        ADD COLUMN auth_config JSONB DEFAULT '{"mode": "hybrid", "allow_email_password": true}';
        
        COMMENT ON COLUMN coheus_tenants.auth_config IS 
            'Authentication configuration: mode (hybrid/sso_only/password_only), allow_email_password, require_mfa, etc.';
    END IF;
END $$;

-- ============================================================================
-- Example: How to add a tenant's IdP configuration
-- ============================================================================
-- INSERT INTO tenant_identity_providers (
--     tenant_id,
--     provider_type,
--     idp_type,
--     cognito_idp_name,
--     email_domains,
--     is_enabled,
--     is_primary
-- ) VALUES (
--     'uuid-of-acme-tenant',
--     'cognito_federated',
--     'okta',
--     'AcmeMortgageOkta',  -- Must match the IdP name in Cognito User Pool
--     ARRAY['acmemortgage.com', 'acme.com'],
--     true,
--     true
-- );

-- ============================================================================
-- Grant permissions
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_identity_providers TO cohi_app;
-- GRANT SELECT, INSERT ON sso_auth_logs TO cohi_app;
