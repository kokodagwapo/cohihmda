-- Migration: LOS Connections and Encompass Integration
-- Created: 2026-01-29
-- Database: tenant
--
-- Creates tables for LOS (Loan Origination System) connectivity:
-- - los_connections (main connection config)
-- - encompass_field_swaps (field mapping overrides)
-- - encompass_token_cache (OAuth token caching)
-- - encompass_concurrency_metrics (API rate limiting tracking)

-- =============================================================================
-- LOS_CONNECTIONS - LOS integration configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS los_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_type TEXT NOT NULL,  -- 'encompass', 'meridianlink', 'calyx', 'custom'
  name TEXT NOT NULL,
  connection_method TEXT NOT NULL,  -- 'api', 'database', 'csv', 'sftp'
  
  -- Encompass-specific fields
  encompass_instance_id TEXT,
  encompass_api_server TEXT DEFAULT 'https://api.elliemae.com',
  encompass_secret_arn TEXT,
  encompass_extraction_method TEXT CHECK (encompass_extraction_method IN ('partner', 'ropc', 'api')),
  encompass_sa_username_encrypted TEXT,
  encompass_sa_password_encrypted TEXT,
  api_client_id_encrypted TEXT,
  api_client_secret_encrypted TEXT,
  encompass_selected_folders JSONB DEFAULT '[]'::jsonb,
  
  -- General LOS fields
  api_base_url TEXT,
  api_key TEXT,
  api_access_token TEXT,
  api_refresh_token TEXT,
  api_token_expires_at TIMESTAMPTZ,
  api_environment TEXT DEFAULT 'sandbox',
  oauth_authorization_url TEXT,
  oauth_token_url TEXT,
  oauth_scopes TEXT,
  
  -- Database connection fields
  db_host TEXT,
  db_port INTEGER,
  db_name TEXT,
  db_user TEXT,
  db_password_encrypted TEXT,
  
  -- CSV/SFTP upload fields
  csv_upload_schedule TEXT,
  csv_last_uploaded_at TIMESTAMPTZ,
  csv_upload_path TEXT,
  csv_field_mapping JSONB,
  sftp_host TEXT,
  sftp_port INTEGER DEFAULT 22,
  sftp_user TEXT,
  sftp_key_encrypted TEXT,
  
  -- Sync settings
  sync_enabled BOOLEAN DEFAULT true,
  sync_frequency TEXT DEFAULT 'hourly',
  last_synced_at TIMESTAMPTZ,
  last_loan_modified_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  last_sync_loans_processed INTEGER,
  
  -- Webhook settings
  webhook_url TEXT,
  webhook_secret TEXT,
  webhook_enabled BOOLEAN DEFAULT false,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_los_connections_active ON los_connections(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_los_connections_type ON los_connections(los_type);
CREATE INDEX IF NOT EXISTS idx_los_connections_sync ON los_connections(sync_enabled, last_synced_at) WHERE sync_enabled = true;

-- =============================================================================
-- ENCOMPASS_FIELD_SWAPS - Field mapping overrides
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_field_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  coheus_alias VARCHAR(255) NOT NULL,
  encompass_field_id VARCHAR(255) NOT NULL,
  swap_type VARCHAR(50) DEFAULT 'Standard' CHECK (swap_type IN ('Standard', 'Profitability')),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(los_connection_id, coheus_alias, swap_type)
);

CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_connection ON encompass_field_swaps(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_encompass_field_swaps_alias ON encompass_field_swaps(coheus_alias);

-- =============================================================================
-- ENCOMPASS_TOKEN_CACHE - OAuth token caching
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_token_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encompass_token_cache_expires ON encompass_token_cache(expires_at);

-- =============================================================================
-- ENCOMPASS_CONCURRENCY_METRICS - API rate limiting tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS encompass_concurrency_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  limit_value INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  utilized INTEGER NOT NULL,
  utilization_ratio DECIMAL(5,4) NOT NULL,
  exceeded_threshold BOOLEAN NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_encompass_concurrency_connection ON encompass_concurrency_metrics(los_connection_id, timestamp DESC);

-- Retention policy: keep only last 7 days of metrics
-- This would be run by a scheduled job in production

-- =============================================================================
-- LOS_SYNC_HISTORY - Track sync operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS los_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  los_connection_id UUID REFERENCES los_connections(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'manual', 'webhook')),
  status TEXT NOT NULL CHECK (status IN ('started', 'in_progress', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  loans_processed INTEGER DEFAULT 0,
  loans_created INTEGER DEFAULT 0,
  loans_updated INTEGER DEFAULT 0,
  loans_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_los_sync_history_connection ON los_sync_history(los_connection_id);
CREATE INDEX IF NOT EXISTS idx_los_sync_history_status ON los_sync_history(status);
CREATE INDEX IF NOT EXISTS idx_los_sync_history_started ON los_sync_history(started_at DESC);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_los_connections_updated_at ON los_connections;
CREATE TRIGGER trigger_los_connections_updated_at
  BEFORE UPDATE ON los_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_encompass_field_swaps_updated_at ON encompass_field_swaps;
CREATE TRIGGER trigger_encompass_field_swaps_updated_at
  BEFORE UPDATE ON encompass_field_swaps
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_encompass_token_cache_updated_at ON encompass_token_cache;
CREATE TRIGGER trigger_encompass_token_cache_updated_at
  BEFORE UPDATE ON encompass_token_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
