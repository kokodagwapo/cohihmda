-- source_insight_id was FK-only to generated_insights; dashboard watchlist uses
-- dashboard_generated_insights ids with source_type = 'dashboard_insights'.
-- Drop the FK so the column is polymorphic (meaning depends on source_type).

ALTER TABLE tracked_insights
  DROP CONSTRAINT IF EXISTS tracked_insights_source_insight_id_fkey;

COMMENT ON COLUMN tracked_insights.source_insight_id IS
  'Source row id; table depends on source_type (e.g. generated_insights, dashboard_generated_insights).';
