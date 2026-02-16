-- =============================================================================
-- Migration 015: Drop unused metric_usage_stats table
-- =============================================================================
-- The metric_usage_stats table was created in migration 005 but was never
-- populated or queried by any part of the application. It also contains the
-- obsolete `used_in_datachat` column. Dropping it to clean up the schema.

DROP TABLE IF EXISTS metric_usage_stats;
