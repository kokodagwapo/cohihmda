-- Migration: Pipeline analysis config guard
-- This is a safe replacement for the former duplicate-version pipeline migration.
-- It guarantees the config table/row exists without overwriting user-selected settings.

CREATE TABLE IF NOT EXISTS public.pipeline_analysis_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  snapshot_day_of_week SMALLINT NOT NULL DEFAULT 1 CHECK (snapshot_day_of_week >= 1 AND snapshot_day_of_week <= 5)
);

INSERT INTO public.pipeline_analysis_config (id, snapshot_day_of_week)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;
