-- Migration: 094_dashboard_insights_supporting_data
-- Description: Add supporting_data JSONB to store by-period metrics for evidence table in the UI.

ALTER TABLE dashboard_generated_insights
  ADD COLUMN IF NOT EXISTS supporting_data JSONB DEFAULT NULL;

COMMENT ON COLUMN dashboard_generated_insights.supporting_data IS 'Snapshot of by-period metrics (e.g. MTD/LM/QTD) for evidence table display.';
