-- Migration: 029_insight_detail_query
-- Description: Adds a detail_query column to generated_insights so the exact SQL
--              and parameters used to derive each insight can be replayed at
--              drill-down time, guaranteeing the detail modal matches the headline.

ALTER TABLE generated_insights ADD COLUMN IF NOT EXISTS detail_query JSONB DEFAULT NULL;

-- detail_query schema:
-- {
--   "sql": "SELECT ... FROM ... WHERE ... ORDER BY ...",
--   "params": [value1, value2, ...],
--   "title": "At-Risk Loans (≥70% Fallout Probability)"
-- }

COMMENT ON COLUMN generated_insights.detail_query IS 'Exact SQL + params to replay the data backing this insight on drill-down';
