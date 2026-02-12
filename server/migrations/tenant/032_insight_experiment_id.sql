-- Migration: 032_insight_experiment_id
-- Description: Adds experiment_id to generated_insights so insights can be
--              tagged with the A/B experiment variant that produced them.
--              This enables comparing feedback/quality across experiment variants.

ALTER TABLE generated_insights ADD COLUMN IF NOT EXISTS experiment_id UUID;

CREATE INDEX IF NOT EXISTS idx_generated_insights_experiment ON generated_insights(experiment_id)
  WHERE experiment_id IS NOT NULL;
