-- Migration: 025_fix_scoring_weights_unique.sql
-- Description: Fix unique constraint for scoring_weights to handle NULL persona_id correctly
-- 
-- PostgreSQL's UNIQUE constraint treats NULL values as distinct, so:
--   UNIQUE(scorecard_type, persona_id, metric_name) 
-- allows multiple rows with persona_id = NULL for the same (scorecard_type, metric_name).
-- 
-- This causes ON CONFLICT to not trigger, inserting duplicates instead of updating.
-- Fix: Create a partial unique index for NULL persona_id cases.

-- =============================================================================
-- STEP 1: Remove duplicate rows (keep the most recent)
-- =============================================================================
DELETE FROM scoring_weights a
USING scoring_weights b
WHERE a.id < b.id
  AND a.scorecard_type = b.scorecard_type
  AND a.metric_name = b.metric_name
  AND a.persona_id IS NULL
  AND b.persona_id IS NULL;

-- =============================================================================
-- STEP 2: Create partial unique index for NULL persona_id
-- =============================================================================
DROP INDEX IF EXISTS idx_scoring_weights_unique_null_persona;
CREATE UNIQUE INDEX idx_scoring_weights_unique_null_persona 
  ON scoring_weights (scorecard_type, metric_name) 
  WHERE persona_id IS NULL;

-- =============================================================================
-- STEP 3: Log the migration
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 025: Fixed scoring_weights unique constraint for NULL persona_id';
END $$;
