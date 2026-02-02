-- Migration: User Lockout Fields
-- Created: 2026-01-31
-- Database: tenant
--
-- Adds failed login attempt tracking and account lockout support to users table

-- =============================================================================
-- ADD LOCKOUT FIELDS TO USERS TABLE
-- =============================================================================

-- Track failed login attempts for account lockout
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;

-- Timestamp when account lockout expires
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Index for finding locked accounts
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until) 
  WHERE locked_until IS NOT NULL;

COMMENT ON COLUMN users.failed_login_attempts IS 'Number of consecutive failed login attempts';
COMMENT ON COLUMN users.locked_until IS 'Timestamp when account lockout expires, NULL if not locked';
