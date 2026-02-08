-- Migration: 024_update_scoring_weights.sql
-- Description: Update scoring_weights to use correct TTS formula weights
-- 
-- The original seed data had wrong metrics and weights.
-- 
-- Sales TTS Formula (6 components, each 20% normalized):
--   TTS = (VolumeRating + MarginRating + UnitRating + 
--          PullThroughRating + TurnTimeRating + ConcessionRating) / 6
--
-- Operations TTS Formula (3 components):
--   TTS = (UnitRating × 70%) + (TurnTimeRating × 15%) + (ComplexityRating × 15%)

-- =============================================================================
-- STEP 1: Clear existing scoring_weights and re-seed with correct values
-- =============================================================================

-- Remove old data with incorrect metrics
DELETE FROM scoring_weights WHERE persona_id IS NULL;

-- Re-seed with correct metrics and weights
INSERT INTO scoring_weights (scorecard_type, persona_id, metric_name, weight, description)
VALUES 
  -- Sales Scorecard (6 components, normalized so average performer scores 100)
  -- Each component is weighted at ~16.67% (1/6), but we store as 0.2 since formula divides by sum
  ('sales', NULL, 'volume', 0.2, 'Total loan volume (dollar amount funded)'),
  ('sales', NULL, 'margin', 0.2, 'Revenue as basis points of loan amount'),
  ('sales', NULL, 'unit', 0.2, 'Number of loans funded'),
  ('sales', NULL, 'pull_through', 0.2, 'Percentage of applications that fund'),
  ('sales', NULL, 'turn_time', 0.2, 'Days from application to close (lower is better)'),
  ('sales', NULL, 'concession', 0.2, 'Price concessions given (lower is better)'),
  
  -- Operations Scorecard (3 components)
  ('operations', NULL, 'units', 0.70, 'Number of loans processed (70% weight)'),
  ('operations', NULL, 'turn_time', 0.15, 'Days to complete processing (15% weight)'),
  ('operations', NULL, 'complexity', 0.15, 'Loan complexity handled (15% weight)')

ON CONFLICT (scorecard_type, persona_id, metric_name) DO UPDATE SET
  weight = EXCLUDED.weight,
  description = EXCLUDED.description,
  updated_at = NOW();

-- =============================================================================
-- STEP 2: Log the migration
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 024: Updated scoring_weights with correct TTS formula weights';
END $$;
