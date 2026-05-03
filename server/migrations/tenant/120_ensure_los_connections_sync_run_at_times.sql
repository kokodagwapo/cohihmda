-- COHI-351: ensure explicit local clock-time scheduling column exists.
-- This is intentionally separate from 119 because 119 may already be recorded
-- in schema_migrations on dev tenants.

ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS sync_run_at_times JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.los_connections.sync_run_at_times IS
  'JSON array of {"hour":0-23,"minute":0-59} in scheduler_timezone. Empty [] means no automatic clock-time schedule.';
