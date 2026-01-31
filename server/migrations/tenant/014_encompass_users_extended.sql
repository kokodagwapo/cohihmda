-- Migration: Encompass Users Extended Fields
-- Created: 2026-01-31
-- Database: tenant
--
-- Adds additional useful fields from Encompass API response

-- =============================================================================
-- ADD EXTENDED FIELDS TO ENCOMPASS_USERS
-- =============================================================================

-- Job title (e.g., "Loan Officer", "Jr Underwriter")
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS job_title TEXT;

-- Personas array (e.g., ["Loan Officer", "Processor"])
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS personas TEXT[];

-- Organization info
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS org_name TEXT;

-- NMLS ID for loan officers
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS nmls_id TEXT;

-- Contact info
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS cell_phone TEXT;

-- Last login timestamp from Encompass
ALTER TABLE encompass_users ADD COLUMN IF NOT EXISTS encompass_last_login TIMESTAMPTZ;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_encompass_users_org ON encompass_users(org_name) WHERE org_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encompass_users_nmls ON encompass_users(nmls_id) WHERE nmls_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encompass_users_personas ON encompass_users USING GIN(personas) WHERE personas IS NOT NULL;

COMMENT ON COLUMN encompass_users.job_title IS 'Job title from Encompass (e.g., Loan Officer)';
COMMENT ON COLUMN encompass_users.personas IS 'Array of Encompass persona names assigned to user';
COMMENT ON COLUMN encompass_users.org_id IS 'Encompass organization entity ID';
COMMENT ON COLUMN encompass_users.org_name IS 'Encompass organization name (branch/department)';
COMMENT ON COLUMN encompass_users.nmls_id IS 'NMLS Originator ID for compliance';
COMMENT ON COLUMN encompass_users.encompass_last_login IS 'Last login timestamp from Encompass';
