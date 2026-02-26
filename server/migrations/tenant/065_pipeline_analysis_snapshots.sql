-- Migration: Pipeline Analysis Snapshots
-- Database: tenant
-- Creates pipeline_analysis_snapshots for weekly snapshots (active units/volume/LO count and percent changes).
-- Snapshot day (Mon–Fri) is configurable via pipeline_analysis_config (see 066_pipeline_analysis_config.sql).

-- =============================================================================
-- PIPELINE_ANALYSIS_SNAPSHOTS - One row per snapshot date with active pipeline metrics
-- Columns: date (snapshot date), index (ordinal), snapshot_weekday (e.g. "Monday")
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_analysis_snapshots (
  "date" DATE PRIMARY KEY,
  index INTEGER NOT NULL UNIQUE,
  snapshot_weekday TEXT NOT NULL DEFAULT 'Monday',
  year INTEGER NOT NULL,
  week_value INTEGER NOT NULL,
  active_units INTEGER NOT NULL DEFAULT 0,
  active_volume DECIMAL(18,2) NOT NULL DEFAULT 0,
  active_lo_count INTEGER NOT NULL DEFAULT 0,
  weekly_pct_change_volume DECIMAL(10,4),
  monthly_pct_change_volume DECIMAL(10,4),
  annual_pct_change_volume DECIMAL(10,4),
  weekly_pct_change_units DECIMAL(10,4),
  monthly_pct_change_units DECIMAL(10,4),
  annual_pct_change_units DECIMAL(10,4),
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migrate existing table: rename monday_date/monday_index and add snapshot_weekday if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_snapshots' AND column_name = 'monday_date') THEN
    ALTER TABLE public.pipeline_analysis_snapshots RENAME COLUMN monday_date TO "date";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_snapshots' AND column_name = 'monday_index') THEN
    ALTER TABLE public.pipeline_analysis_snapshots RENAME COLUMN monday_index TO index;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_snapshots' AND column_name = 'snapshot_weekday') THEN
    ALTER TABLE public.pipeline_analysis_snapshots ADD COLUMN snapshot_weekday TEXT NOT NULL DEFAULT 'Monday';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pipeline_analysis_snapshots' AND column_name = 'active_lo_count') THEN
    ALTER TABLE public.pipeline_analysis_snapshots ADD COLUMN active_lo_count INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_pipeline_analysis_snapshots_monday_index;
CREATE INDEX IF NOT EXISTS idx_pipeline_analysis_snapshots_index
  ON public.pipeline_analysis_snapshots(index);
CREATE INDEX IF NOT EXISTS idx_pipeline_analysis_snapshots_year_week
  ON public.pipeline_analysis_snapshots(year, week_value);

COMMENT ON TABLE public.pipeline_analysis_snapshots IS 'Weekly pipeline snapshots per configured weekday: active units/volume/LO count and week/month/year percent change. Populated by backfill (full recalc when snapshot day changes).';


