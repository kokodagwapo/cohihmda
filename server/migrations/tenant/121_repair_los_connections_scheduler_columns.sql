-- COHI-351 repair: ensure all per-connection scheduler policy columns exist on
-- los_connections, even on tenants that fell behind because earlier migrations
-- (116/119) were renumbered/added late and never reached every dev DB.
--
-- This migration is intentionally idempotent (IF NOT EXISTS, DROP/ADD CONSTRAINT
-- with IF EXISTS guards) so it is safe to apply on a tenant whose 116 already ran,
-- on a tenant whose 116 never ran, and on a tenant where parts of 116 ran but the
-- rest was lost in a previous renumbering.

-- Columns introduced by 116_los_connections_scheduler_policy.sql
ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS encompass_users_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sync_business_days_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS insights_business_days_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scheduler_timezone TEXT NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS sync_allowed_weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS sync_allowed_hours SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS last_encompass_users_sync_at TIMESTAMPTZ;

-- Column introduced by 119_los_connections_sync_run_at_times.sql
ALTER TABLE public.los_connections
  ADD COLUMN IF NOT EXISTS sync_run_at_times JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Constraints from 116 (re-asserted idempotently)
ALTER TABLE public.los_connections
  DROP CONSTRAINT IF EXISTS los_connections_sync_allowed_weekdays_valid,
  ADD CONSTRAINT los_connections_sync_allowed_weekdays_valid
  CHECK (
    COALESCE(array_length(sync_allowed_weekdays, 1), 0) BETWEEN 1 AND 7
    AND sync_allowed_weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
  );

ALTER TABLE public.los_connections
  DROP CONSTRAINT IF EXISTS los_connections_sync_allowed_hours_valid,
  ADD CONSTRAINT los_connections_sync_allowed_hours_valid
  CHECK (
    COALESCE(array_length(sync_allowed_hours, 1), 0) BETWEEN 1 AND 24
    AND sync_allowed_hours <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::SMALLINT[]
  );

UPDATE public.los_connections
SET sync_allowed_weekdays = ARRAY[1,2,3,4,5]::SMALLINT[]
WHERE sync_business_days_only = TRUE
  AND sync_allowed_weekdays = ARRAY[0,1,2,3,4,5,6]::SMALLINT[];

COMMENT ON COLUMN public.los_connections.encompass_users_sync_enabled IS 'When true, run Encompass user cache sync after successful Encompass loan sync (post-sync hook).';
COMMENT ON COLUMN public.los_connections.sync_business_days_only IS 'When true, automatic LOS scheduler skips Sat/Sun in scheduler_timezone.';
COMMENT ON COLUMN public.los_connections.insights_business_days_only IS 'When true, post-sync prediction/agent/tracked hooks skip weekends only for scheduled-trigger syncs.';
COMMENT ON COLUMN public.los_connections.scheduler_timezone IS 'IANA timezone for business-day / weekend decisions for scheduler and scheduled-trigger insight hooks.';
COMMENT ON COLUMN public.los_connections.sync_allowed_weekdays IS 'Allowed automatic sync weekdays in scheduler_timezone, 0=Sunday through 6=Saturday.';
COMMENT ON COLUMN public.los_connections.sync_allowed_hours IS 'Allowed automatic sync start hours in scheduler_timezone, 0 through 23.';
COMMENT ON COLUMN public.los_connections.last_encompass_users_sync_at IS 'Last successful Encompass user cache sync (post-sync hook); used for throttling and admin display.';
COMMENT ON COLUMN public.los_connections.sync_run_at_times IS
  'JSON array of {"hour":0-23,"minute":0-59} in scheduler_timezone. Empty [] means no automatic clock-time schedule.';
