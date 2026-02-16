-- Migration: Password Reset Tokens
-- Created: 2026-02-14
-- Database: management
--
-- Moves password reset tokens from in-memory Map to a durable database table.
-- Tokens are stored as SHA-256 hashes (never store raw tokens).
-- Stored in management DB only (central location for both super admins and tenant users).

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  tenant_slug TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by token hash (only unused tokens)
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash 
  ON password_reset_tokens(token_hash) 
  WHERE used_at IS NULL;

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_reset_tokens_expires 
  ON password_reset_tokens(expires_at) 
  WHERE used_at IS NULL;
