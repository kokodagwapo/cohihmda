-- Migration: Drop share_links table (PIN-protected share links removed)
-- Database: management
-- Reverts 009_share_links.sql; sharing is now in-app user picker only.

DROP TRIGGER IF EXISTS trigger_share_links_updated_at ON share_links;
DROP INDEX IF EXISTS idx_share_links_token;
DROP INDEX IF EXISTS idx_share_links_target;
DROP INDEX IF EXISTS idx_share_links_tenant;
DROP INDEX IF EXISTS idx_share_links_created_by;
DROP TABLE IF EXISTS share_links;
