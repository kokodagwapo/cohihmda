-- Migration: Pipeline Analysis Snapshots - add snapshot_weekday if missing; ensure config default
-- Database: tenant
-- Ensures pipeline_analysis_snapshots has snapshot_weekday (for older DBs created before this column existed).
-- Resets pipeline_analysis_config to Monday (1) so a run of this migration gives the expected default.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_snapshots' AND column_name = 'snapshot_weekday'
  ) THEN
    ALTER TABLE public.pipeline_analysis_snapshots ADD COLUMN snapshot_weekday TEXT NOT NULL DEFAULT 'Monday';
  END IF;
END $$;

-- Ensure config defaults to Monday (1) when this migration runs (fixes DBs that had 3 or other value)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_config') THEN
    UPDATE public.pipeline_analysis_config SET snapshot_day_of_week = 1 WHERE id = 1;
  END IF;
END $$;
