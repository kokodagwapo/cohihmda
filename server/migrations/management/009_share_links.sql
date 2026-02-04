-- Migration: Share links with PIN protection
-- Created: 2026-02-03
-- Database: management
--
-- Adds share_links for server-backed secure sharing.

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id TEXT,
  tenant_id UUID,
  target_url TEXT NOT NULL,
  label TEXT,
  pin_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_target ON share_links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_share_links_tenant ON share_links(tenant_id);
CREATE INDEX IF NOT EXISTS idx_share_links_created_by ON share_links(created_by);

-- Keep updated_at current
DROP TRIGGER IF EXISTS trigger_share_links_updated_at ON share_links;
CREATE TRIGGER trigger_share_links_updated_at
  BEFORE UPDATE ON share_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
