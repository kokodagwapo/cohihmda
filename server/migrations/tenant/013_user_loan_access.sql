-- Migration: User Loan Access
-- Created: 2026-01-31
-- Database: tenant
--
-- Creates junction table for storing which loans each user can access
-- This mirrors Encompass permissions by syncing accessible loan GUIDs per user

-- =============================================================================
-- USER_LOAN_ACCESS - Junction table for user-specific loan access
-- =============================================================================
-- This table stores which loan GUIDs each user can access, derived from
-- querying the Encompass Pipeline API with user impersonation tokens.
-- This mirrors the exact permissions each user has in Encompass.

CREATE TABLE IF NOT EXISTS user_loan_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_guid TEXT NOT NULL,  -- References loans.guid (not FK to allow for timing)
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, loan_guid)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_loan_access_user ON user_loan_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_loan_access_loan ON user_loan_access(loan_guid);
CREATE INDEX IF NOT EXISTS idx_user_loan_access_synced ON user_loan_access(synced_at);
CREATE INDEX IF NOT EXISTS idx_user_loan_access_user_los ON user_loan_access(user_id, los_connection_id);

COMMENT ON TABLE user_loan_access IS 'Stores which loans each user can access, mirroring Encompass permissions';
COMMENT ON COLUMN user_loan_access.loan_guid IS 'Loan GUID from Encompass that user can access';
COMMENT ON COLUMN user_loan_access.synced_at IS 'When this access was last verified from Encompass';

-- =============================================================================
-- USER_LOAN_ACCESS_SYNC_LOG - Track access sync operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_loan_access_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  loans_accessible INTEGER DEFAULT 0,
  loans_added INTEGER DEFAULT 0,
  loans_removed INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_loan_access_sync_user ON user_loan_access_sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_loan_access_sync_status ON user_loan_access_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_user_loan_access_sync_started ON user_loan_access_sync_log(started_at DESC);

-- =============================================================================
-- ADD ACCESS MODE COLUMN TO USERS
-- =============================================================================
-- Determines how loan access is controlled for this user
-- 'encompass_sync' = Access synced from Encompass via impersonation
-- 'full_access' = Can see all loans (admins)
-- 'no_access' = Cannot see any individual loans (viewers)
-- 'manual' = Access manually configured by admin

ALTER TABLE users ADD COLUMN IF NOT EXISTS loan_access_mode TEXT 
  DEFAULT 'encompass_sync'
  CHECK (loan_access_mode IN ('encompass_sync', 'full_access', 'no_access', 'manual'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS loan_access_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN users.loan_access_mode IS 'How loan access is determined: encompass_sync, full_access, no_access, manual';
COMMENT ON COLUMN users.loan_access_synced_at IS 'When loan access was last synced from Encompass';
