-- 049: Add detail_data JSONB column to generated_insights
-- Stores a complete detail snapshot (title, summary, rows, displayConfig) at
-- generation time so the detail modal can render it directly without re-querying.

ALTER TABLE generated_insights
  ADD COLUMN IF NOT EXISTS detail_data JSONB DEFAULT NULL;

COMMENT ON COLUMN generated_insights.detail_data IS
  'Complete detail snapshot: {title, summary, rows, displayConfig}. Rendered directly by the frontend without re-querying.';
