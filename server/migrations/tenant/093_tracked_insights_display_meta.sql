-- Migration 093: Add display_metadata column to tracked_insights
-- Stores human-readable metric descriptions and formats from the source insight's
-- detail_data so the watchlist detail view can render metrics with proper labels.

ALTER TABLE tracked_insights
  ADD COLUMN IF NOT EXISTS display_metadata JSONB;

COMMENT ON COLUMN tracked_insights.display_metadata IS
  'Metric display hints persisted at tracking time: keyMetricDescriptions, keyMetricFormats from the source agent insight';
