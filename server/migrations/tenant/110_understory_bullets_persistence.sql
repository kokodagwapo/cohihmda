-- Migration 110: Persist finalized insight bullets for reuse
-- Adds understory_bullets to daily and dashboard insight tables.

ALTER TABLE generated_insights
  ADD COLUMN IF NOT EXISTS understory_bullets JSONB;

COMMENT ON COLUMN generated_insights.understory_bullets IS
  'Finalized bullet list derived from understory or agent finding summary.';

ALTER TABLE dashboard_generated_insights
  ADD COLUMN IF NOT EXISTS understory_bullets JSONB;

COMMENT ON COLUMN dashboard_generated_insights.understory_bullets IS
  'Finalized bullet list for dashboard insights; reused on read paths.';
