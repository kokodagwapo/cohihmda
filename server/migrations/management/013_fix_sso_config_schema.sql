-- Migration: Fix SSO Config Schema
-- Created: 2026-02-12
-- Database: management
--
-- Fixes column mismatches between ssoConfig.ts code and the tenant_identity_providers table
-- The original 003_auth_config.sql had restrictive CHECK constraints and missing columns

-- =============================================================================
-- 1. Drop the restrictive CHECK constraint on provider_type (if it exists)
-- =============================================================================
DO $$ BEGIN
  ALTER TABLE tenant_identity_providers DROP CONSTRAINT IF EXISTS tenant_identity_providers_provider_type_check;
EXCEPTION WHEN undefined_table THEN
  -- Table doesn't exist yet, will be created by 003
  NULL;
END $$;

-- =============================================================================
-- 2. Add 'config' JSONB column for storing IdP configuration details
-- =============================================================================
ALTER TABLE tenant_identity_providers ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- =============================================================================
-- 3. Add 'created_by' UUID column for tracking who created the config
-- =============================================================================
ALTER TABLE tenant_identity_providers ADD COLUMN IF NOT EXISTS created_by UUID;

-- =============================================================================
-- 4. Make 'provider_name' nullable with a default (was NOT NULL before)
-- =============================================================================
DO $$ BEGIN
  ALTER TABLE tenant_identity_providers ALTER COLUMN provider_name SET DEFAULT '';
  ALTER TABLE tenant_identity_providers ALTER COLUMN provider_name DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN
  -- Column doesn't exist, 003 will create it with the right definition
  NULL;
WHEN undefined_table THEN
  NULL;
END $$;
