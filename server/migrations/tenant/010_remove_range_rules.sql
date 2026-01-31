-- Migration: 010_remove_range_rules.sql
-- Description: Remove range_rules table (feature not implemented/used)
-- The Range Rules feature was planned but never fully implemented.
-- This migration removes the unused table and frees up resources.

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_range_rules_updated_at ON range_rules;

-- Drop indexes
DROP INDEX IF EXISTS idx_range_rules_field;
DROP INDEX IF EXISTS idx_range_rules_active;

-- Drop the table
DROP TABLE IF EXISTS range_rules;

-- Add comment for audit trail
COMMENT ON SCHEMA public IS 'Range rules table removed in migration 010 - feature was not implemented';
