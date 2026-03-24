-- Migration: 095_dashboard_insights_detail_data
-- Description: Add detail_data JSONB to store InsightDetailSnapshot-shaped payload for evidence (same shape as original pipeline insights).

ALTER TABLE dashboard_generated_insights
  ADD COLUMN IF NOT EXISTS detail_data JSONB DEFAULT NULL;

COMMENT ON COLUMN dashboard_generated_insights.detail_data IS 'Pre-hydrated detail snapshot (title, summary, rows, displayConfig, etm, comparison, audit) for details API and InsightDetailModal.';
