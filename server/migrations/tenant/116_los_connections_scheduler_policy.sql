-- COHI-351: Per-connection scheduler policy, insight weekend gate, Encompass user cache sync metadata
ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS encompass_users_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sync_business_days_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insights_business_days_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scheduler_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS last_encompass_users_sync_at TIMESTAMPTZ;

COMMENT ON COLUMN public.los_connections.encompass_users_sync_enabled IS 'When true, run Encompass user cache sync after successful Encompass loan sync (post-sync hook).';
COMMENT ON COLUMN public.los_connections.sync_business_days_only IS 'When true, automatic LOS scheduler skips Sat/Sun in scheduler_timezone.';
COMMENT ON COLUMN public.los_connections.insights_business_days_only IS 'When true, post-sync prediction/agent/tracked hooks skip weekends only for scheduled-trigger syncs.';
COMMENT ON COLUMN public.los_connections.scheduler_timezone IS 'IANA timezone for business-day / weekend decisions for scheduler and scheduled-trigger insight hooks.';
COMMENT ON COLUMN public.los_connections.last_encompass_users_sync_at IS 'Last successful Encompass user cache sync (post-sync hook); used for throttling and admin display.';
