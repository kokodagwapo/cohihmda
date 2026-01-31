-- Migration: Add auth lockout columns to coheus_users
-- Created: 2026-01-31
-- Database: management
--
-- Adds missing columns for account lockout feature

-- Add failed_login_attempts column if missing
ALTER TABLE coheus_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;

-- Add locked_until column if missing
ALTER TABLE coheus_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Also ensure password_reset columns exist
ALTER TABLE coheus_users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE coheus_users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;
