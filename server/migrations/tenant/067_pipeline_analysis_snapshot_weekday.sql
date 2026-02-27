-- Migration: Pipeline Analysis - ensure config default for snapshot weekday
-- Database: tenant
-- Resets pipeline_analysis_config to Monday (1) so a run of this migration gives the expected default.
-- Pipeline snapshots are now computed live from loans; no snapshot table is used.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_config') THEN
    UPDATE public.pipeline_analysis_config SET snapshot_day_of_week = 1 WHERE id = 1;
  END IF;
END $$;
