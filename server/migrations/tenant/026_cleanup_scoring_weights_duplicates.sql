-- Migration: 026_cleanup_scoring_weights_duplicates.sql
-- Description: Properly cleanup duplicate scoring_weights using timestamps (not UUID comparison)
-- 
-- The previous migration (025) used UUID comparison which doesn't give us the most recent row.
-- This migration uses updated_at/created_at timestamps to keep the most recently modified row.

-- =============================================================================
-- STEP 1: Remove duplicate rows, keeping the one with most recent updated_at
-- =============================================================================

-- For rows with NULL persona_id (default weights)
DELETE FROM scoring_weights a
USING scoring_weights b
WHERE a.scorecard_type = b.scorecard_type
  AND a.metric_name = b.metric_name
  AND a.persona_id IS NULL
  AND b.persona_id IS NULL
  AND a.id != b.id
  AND (
    -- Keep the one with most recent updated_at
    a.updated_at < b.updated_at
    -- If updated_at is the same, use created_at
    OR (a.updated_at = b.updated_at AND a.created_at < b.created_at)
    -- If both are the same, use id as tiebreaker (arbitrary but deterministic)
    OR (a.updated_at = b.updated_at AND a.created_at = b.created_at AND a.id < b.id)
  );

-- For rows with non-NULL persona_id
DELETE FROM scoring_weights a
USING scoring_weights b
WHERE a.scorecard_type = b.scorecard_type
  AND a.metric_name = b.metric_name
  AND a.persona_id IS NOT NULL
  AND b.persona_id IS NOT NULL
  AND a.persona_id = b.persona_id
  AND a.id != b.id
  AND (
    a.updated_at < b.updated_at
    OR (a.updated_at = b.updated_at AND a.created_at < b.created_at)
    OR (a.updated_at = b.updated_at AND a.created_at = b.created_at AND a.id < b.id)
  );

-- =============================================================================
-- STEP 2: Log the cleanup
-- =============================================================================
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count FROM scoring_weights;
  RAISE NOTICE 'Migration 026: Cleaned up duplicate scoring_weights. Remaining rows: %', remaining_count;
END $$;
