-- Migration: Pipeline Analysis Config
-- Database: tenant
-- Creates pipeline_analysis_config: single row specifying which weekday (Mon–Fri) to use for pipeline snapshots.

-- =============================================================================
-- PIPELINE_ANALYSIS_CONFIG - Single row: which weekday to use for snapshots (1=Mon .. 5=Fri)
-- Default is 1 (Monday). Use DO NOTHING on conflict so re-running migrations does not overwrite a user's chosen day.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.pipeline_analysis_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  snapshot_day_of_week SMALLINT NOT NULL DEFAULT 1 CHECK (snapshot_day_of_week >= 1 AND snapshot_day_of_week <= 5)
);
INSERT INTO public.pipeline_analysis_config (id, snapshot_day_of_week) VALUES (1, 1)
  ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE public.pipeline_analysis_config IS 'Which weekday (1=Mon .. 5=Fri) to use for pipeline snapshot dates. Changing triggers full wipe and recalc.';
