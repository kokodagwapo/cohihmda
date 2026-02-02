-- Migration: Encompass Users
-- Created: 2026-01-30
-- Database: tenant
--
-- Creates tables for Encompass user sync and user-Encompass linking

-- =============================================================================
-- ENCOMPASS_USERS - Cached Encompass users for admin invitation UI
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  encompass_user_id TEXT NOT NULL,        -- Encompass user GUID
  username TEXT NOT NULL,                  -- Encompass userName
  email TEXT,                              -- User email
  first_name TEXT,                         -- First name
  last_name TEXT,                          -- Last name
  full_name TEXT GENERATED ALWAYS AS (
    CASE 
      WHEN first_name IS NOT NULL AND last_name IS NOT NULL THEN first_name || ' ' || last_name
      WHEN first_name IS NOT NULL THEN first_name
      WHEN last_name IS NOT NULL THEN last_name
      ELSE username
    END
  ) STORED,
  user_indicators TEXT[],                  -- Array of indicators (Enabled, ApiUser, etc.)
  is_enabled BOOLEAN DEFAULT true,         -- Active in Encompass
  cohi_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Linked Cohi user (if invited)
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, encompass_user_id)
);

CREATE INDEX IF NOT EXISTS idx_encompass_users_los ON encompass_users(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_encompass_users_email ON encompass_users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encompass_users_enabled ON encompass_users(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_encompass_users_cohi_user ON encompass_users(cohi_user_id) WHERE cohi_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_encompass_users_full_name ON encompass_users(full_name);

-- =============================================================================
-- ADD ENCOMPASS LINK TO USERS TABLE
-- =============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS encompass_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS los_connection_id UUID REFERENCES los_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_encompass_user_id ON users(encompass_user_id) WHERE encompass_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_los_connection ON users(los_connection_id) WHERE los_connection_id IS NOT NULL;

COMMENT ON COLUMN users.encompass_user_id IS 'Linked Encompass user ID for loan access scoping';
COMMENT ON COLUMN users.los_connection_id IS 'LOS connection this user is linked to';

-- =============================================================================
-- ENCOMPASS_USER_SYNC_LOG - Track sync operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_user_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  users_fetched INTEGER DEFAULT 0,
  users_added INTEGER DEFAULT 0,
  users_updated INTEGER DEFAULT 0,
  users_disabled INTEGER DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_encompass_sync_log_los ON encompass_user_sync_log(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_encompass_sync_log_status ON encompass_user_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_encompass_sync_log_started ON encompass_user_sync_log(started_at DESC);
