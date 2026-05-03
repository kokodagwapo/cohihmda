-- COHI-351: optional explicit local clock times for automatic LOS sync (per scheduler_timezone).
-- When non-empty, the scheduler runs once per listed time per calendar day in that timezone
-- (aligned to the 15-minute scheduler tick). When empty, legacy sync_frequency + sync_allowed_hours apply.

ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS sync_run_at_times JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.los_connections.sync_run_at_times IS
  'JSON array of {"hour":0-23,"minute":0-59} in scheduler_timezone. Empty [] uses legacy hourly/daily/weekly + sync_allowed_hours windowing.';
