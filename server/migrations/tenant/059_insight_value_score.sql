-- Migration 058: Add value_score column to generated_insights
-- Computed post-evaluation score that factors in dollar impact, evidence depth,
-- and confidence level to surface the most valuable insights.

ALTER TABLE generated_insights
  ADD COLUMN IF NOT EXISTS value_score DECIMAL(5, 4);
